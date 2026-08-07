#include "lora_driver.h"

#include <stdint.h>
#include <string.h>
#include <sys/time.h>
#include <time.h>

#include "freertos/task.h"

#include "esp_attr.h"
#include "esp_log.h"
#include "esp_task_wdt.h"
#include "portmacro.h"
#include "driver/gpio.h"

#include "RadioLib.h"
#include "EspHal.h"
#include "storage_manager.h"
#include "time_utils.h"

static const char *TAG_LORA = "LORA_RX";

#define LORA_SCK_PIN  11
#define LORA_MISO_PIN 10
#define LORA_MOSI_PIN 9
#define LORA_CS_PIN   8
#define LORA_RST_PIN  6
#define LORA_DIO0_PIN 7

#define LORA_BINARY_PACKET_LEN 3
#define DEVICE_ID_MIN 51
#define DEVICE_ID_MAX 85
#define DEVICE_CODE_BITS 6
#define DEVICE_CODE_SHIFT 18
#define DEVICE_CODE_MASK ((1U << DEVICE_CODE_BITS) - 1U)
#define LORA_IDLE_LOG_INTERVAL_SEC 30
#define LORA_VERBOSE_DIAGNOSTICS 0

static_assert((DEVICE_ID_MAX - DEVICE_ID_MIN) <= DEVICE_CODE_MASK,
              "DEVICE_ID range exceeds LoRa packet device-code field");

static QueueHandle_t s_lora_data_queue = NULL;
static EspHal *s_hal = nullptr;
static uint32_t s_lora_irq_count = 0;
static uint32_t s_lora_idle_ticks = 0;
static portMUX_TYPE s_lora_counter_lock = portMUX_INITIALIZER_UNLOCKED;
static uint32_t s_lora_mqtt_queue_drop_count = 0;
static uint32_t s_lora_crc_drop_count = 0;
static class DriverSX1278 *s_radio = nullptr;
static TaskHandle_t s_lora_receive_task_handle = NULL;

static uint32_t lora_irq_count_snapshot(void)
{
    portENTER_CRITICAL(&s_lora_counter_lock);
    uint32_t value = s_lora_irq_count;
    portEXIT_CRITICAL(&s_lora_counter_lock);
    return value;
}

static void format_raw_hex(const uint8_t *buf, size_t len, char *out, size_t out_len)
{
    if (out == NULL || out_len == 0) {
        return;
    }

    size_t pos = 0;
    for (size_t i = 0; i < len && pos + 2 < out_len; ++i) {
        int written = snprintf(out + pos, out_len - pos, "%02X", buf[i]);
        if (written != 2) {
            break;
        }
        pos += 2;
    }
    out[pos] = 0;
}

static void format_temp_tenths(char *out, size_t out_len, uint16_t tenths)
{
    snprintf(out, out_len, "%u.%u", tenths / 10, tenths % 10);
}

static bool decode_binary_packet(const uint8_t *buf, size_t len, char *out, size_t out_len)
{
    if (len != LORA_BINARY_PACKET_LEN) {
        return false;
    }

    uint32_t packed = ((uint32_t)buf[0] << 16) | ((uint32_t)buf[1] << 8) | (uint32_t)buf[2];
    uint8_t device_code = (uint8_t)((packed >> DEVICE_CODE_SHIFT) & DEVICE_CODE_MASK);
    if (device_code > (DEVICE_ID_MAX - DEVICE_ID_MIN)) {
        return false;
    }

    uint8_t device_id = DEVICE_ID_MIN + device_code;
    uint16_t temp1_tenths = (uint16_t)((packed >> 9) & 0x01FF);
    uint16_t temp2_tenths = (uint16_t)(packed & 0x01FF);

    char temp1[16] = {};
    char temp2[16] = {};
    format_temp_tenths(temp1, sizeof(temp1), temp1_tenths);
    format_temp_tenths(temp2, sizeof(temp2), temp2_tenths);
    snprintf(out, out_len, "%un%st%s", device_id, temp1, temp2);
    return true;
}

class DriverSX1278 : public SX1278 {
  public:
    using SX1278::SX1278;

    void reset() override
    {
        Module *mod = this->getMod();
        ESP_LOGI(TAG_LORA, "RadioLib reset: RST low");
        mod->hal->pinMode(mod->getRst(), mod->hal->GpioModeOutput);
        mod->hal->digitalWrite(mod->getRst(), mod->hal->GpioLevelLow);
        mod->hal->delay(20);

        ESP_LOGI(TAG_LORA, "RadioLib reset: RST high");
        mod->hal->digitalWrite(mod->getRst(), mod->hal->GpioLevelHigh);
        mod->hal->delay(50);
    }

    void probeRegisters(const char *tag)
    {
        Module *mod = this->getMod();
        uint8_t version = mod->SPIreadRegister(RADIOLIB_SX127X_REG_VERSION);
        uint8_t op_mode = readOpMode();
        uint8_t pa_config = mod->SPIreadRegister(RADIOLIB_SX127X_REG_PA_CONFIG);
        uint8_t modem_config_1 = mod->SPIreadRegister(RADIOLIB_SX127X_REG_MODEM_CONFIG_1);
        uint8_t modem_config_2 = mod->SPIreadRegister(RADIOLIB_SX127X_REG_MODEM_CONFIG_2);
        uint8_t irq_flags = readIrqFlags();
        ESP_LOGI(
            TAG_LORA,
            "%s VERSION=0x%02X OP_MODE=0x%02X PA=0x%02X MC1=0x%02X MC2=0x%02X IRQ=0x%02X",
            tag,
            version,
            op_mode,
            pa_config,
            modem_config_1,
            modem_config_2,
            irq_flags
        );
    }

    uint8_t readIrqFlags()
    {
        return this->getMod()->SPIreadRegister(RADIOLIB_SX127X_REG_IRQ_FLAGS);
    }

    uint8_t readOpMode()
    {
        return this->getMod()->SPIreadRegister(RADIOLIB_SX127X_REG_OP_MODE);
    }

    bool isRxContinuous()
    {
        return (readOpMode() & 0x07) == RADIOLIB_SX127X_RXCONTINUOUS;
    }

    int16_t forceRxContinuous()
    {
        return this->getMod()->SPIsetRegValue(
            RADIOLIB_SX127X_REG_OP_MODE,
            RADIOLIB_SX127X_RXCONTINUOUS,
            2,
            0,
            5,
            0xFF,
            true
        );
    }
};

static void lora_probe_registers_if_verbose(const char *tag)
{
#if LORA_VERBOSE_DIAGNOSTICS
    if (s_radio != nullptr) {
        s_radio->probeRegisters(tag);
    }
#else
    (void)tag;
#endif
}

static void lora_fill_common_record(lora_data_t *record,
                                    const char *status,
                                    size_t raw_len,
                                    int16_t read_state,
                                    const uint8_t *raw)
{
    memset(record, 0, sizeof(*record));
    record->tick_ms = (uint32_t)esp_log_timestamp();
    timestamp_info_t ts = {};
    time_utils_get_timestamp(&ts);
    record->boot_id = ts.boot_id;
    record->rx_epoch = ts.epoch;
    record->time_valid = ts.time_valid;
    snprintf(record->rx_time, sizeof(record->rx_time), "%s", ts.text);
    snprintf(record->time_source, sizeof(record->time_source), "%s", ts.time_source);
    record->irq_count = lora_irq_count_snapshot();
    record->raw_len = (raw_len > UINT16_MAX) ? UINT16_MAX : (uint16_t)raw_len;
    record->read_state = read_state;
    if (s_radio != nullptr) {
        record->rssi_tenths = (int16_t)(s_radio->getRSSI() * 10.0f);
        record->snr_tenths = (int16_t)(s_radio->getSNR() * 10.0f);
        record->freq_error_hz = (int16_t)s_radio->getFrequencyError(false);
    }
    snprintf(record->status, sizeof(record->status), "%s", status != NULL ? status : "UNKNOWN");
    if (raw != NULL && raw_len > 0) {
        format_raw_hex(raw, raw_len, record->raw_hex, sizeof(record->raw_hex));
    }
}

static void lora_prepare_module_reset(void)
{
    gpio_config_t rst_cfg = {};
    rst_cfg.pin_bit_mask = (1ULL << LORA_RST_PIN);
    rst_cfg.mode = GPIO_MODE_OUTPUT;
    rst_cfg.pull_up_en = GPIO_PULLUP_DISABLE;
    rst_cfg.pull_down_en = GPIO_PULLDOWN_DISABLE;
    rst_cfg.intr_type = GPIO_INTR_DISABLE;
    gpio_config(&rst_cfg);

    gpio_set_level((gpio_num_t)LORA_RST_PIN, 0);
    vTaskDelay(pdMS_TO_TICKS(10));
    gpio_set_level((gpio_num_t)LORA_RST_PIN, 1);
    vTaskDelay(pdMS_TO_TICKS(20));
}

static void IRAM_ATTR lora_packet_received_isr(void)
{
    portENTER_CRITICAL_ISR(&s_lora_counter_lock);
    s_lora_irq_count++;
    portEXIT_CRITICAL_ISR(&s_lora_counter_lock);
    BaseType_t higher_priority_task_woken = pdFALSE;
    if (s_lora_receive_task_handle != NULL) {
        vTaskNotifyGiveFromISR(s_lora_receive_task_handle, &higher_priority_task_woken);
    }
    if (higher_priority_task_woken == pdTRUE) {
        portYIELD_FROM_ISR();
    }
}

static bool lora_start_receive_with_retry(void)
{
    if (s_radio == nullptr) {
        return false;
    }

    for (int attempt = 1; attempt <= 3; ++attempt) {
        int state = s_radio->startReceive();
        if (state == RADIOLIB_ERR_NONE) {
            if (!s_radio->isRxContinuous()) {
                ESP_LOGW(TAG_LORA, "startReceive ok but radio is not RXCONTINUOUS; forcing RX mode");
                int fix_state = s_radio->forceRxContinuous();
                ESP_LOGI(TAG_LORA, "forceRxContinuous() = %d", fix_state);
            }
            lora_probe_registers_if_verbose("rx-armed");
            return true;
        }

        ESP_LOGW(TAG_LORA, "startReceive failed (%d/3): %d", attempt, state);
        s_radio->probeRegisters("rx-arm-failed");
        vTaskDelay(pdMS_TO_TICKS(50 * attempt));
    }

    return false;
}

static void lora_receive_task(void *pvParameters)
{
    uint8_t buf[255];
    ESP_LOGI(TAG_LORA, "LoRa receive task running");
    s_lora_receive_task_handle = xTaskGetCurrentTaskHandle();

    if (s_radio == nullptr) {
        ESP_LOGE(TAG_LORA, "Radio not initialized");
        vTaskDelete(NULL);
        return;
    }

    esp_task_wdt_add(NULL);
    s_radio->setPacketReceivedAction(lora_packet_received_isr);

    ESP_LOGI(TAG_LORA, "Starting continuous receive mode");
    bool receive_armed = lora_start_receive_with_retry();
    if (!receive_armed) {
        ESP_LOGW(TAG_LORA, "Continuous receive start failed; retrying in background");
    } else {
        ESP_LOGI(TAG_LORA, "Continuous receive mode armed; waiting for packets");
    }

    while (1) {
        esp_task_wdt_reset();

        if (!receive_armed) {
            receive_armed = lora_start_receive_with_retry();
            if (!receive_armed) {
                continue;
            }
            ESP_LOGI(TAG_LORA, "Continuous receive mode recovered");
        }

        uint32_t notified = ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(1000));
        bool packet_pending = false;
        if (notified == 0) {
            uint8_t irq_flags = s_radio->readIrqFlags();
            if ((irq_flags & RADIOLIB_SX127X_CLEAR_IRQ_FLAG_RX_DONE) != 0 ||
                (irq_flags & RADIOLIB_SX127X_CLEAR_IRQ_FLAG_PAYLOAD_CRC_ERROR) != 0) {
                ESP_LOGW(TAG_LORA, "Polled RX IRQ flags=0x%02X irq_count=%lu",
                         irq_flags, (unsigned long)lora_irq_count_snapshot());
                lora_probe_registers_if_verbose("rx-polled");
                packet_pending = true;
            } else if (!s_radio->isRxContinuous()) {
                ESP_LOGW(TAG_LORA, "Radio left RXCONTINUOUS; restarting receive");
                s_radio->probeRegisters("rx-not-continuous");
                receive_armed = lora_start_receive_with_retry();
                continue;
            }

            if (!packet_pending) {
                s_lora_idle_ticks++;
                if ((s_lora_idle_ticks % LORA_IDLE_LOG_INTERVAL_SEC) == 0) {
                    ESP_LOGI(TAG_LORA, "RX idle %lu sec, irq_count=%lu mqtt_queue_drop=%lu crc_drop=%lu",
                             (unsigned long)s_lora_idle_ticks,
                             (unsigned long)lora_irq_count_snapshot(),
                             (unsigned long)s_lora_mqtt_queue_drop_count,
                             (unsigned long)s_lora_crc_drop_count);
                    lora_probe_registers_if_verbose("rx-idle");
                }
                continue;
            }
        }

        s_lora_idle_ticks = 0;
        if (notified != 0) {
            ESP_LOGI(TAG_LORA, "DIO0 notification received, notify=%lu irq_count=%lu",
                     (unsigned long)notified, (unsigned long)lora_irq_count_snapshot());
            lora_probe_registers_if_verbose("rx-notified");
        }

        size_t rxLen = s_radio->getPacketLength();
        if (rxLen > 0 && rxLen <= sizeof(buf)) {
            int state = s_radio->readData(buf, rxLen);
            lora_data_t lora_data;

            if (state == RADIOLIB_ERR_NONE) {
                char ascii_buf[256];
                bool binary_packet = decode_binary_packet(buf, rxLen, ascii_buf, sizeof(ascii_buf));
                if (!binary_packet) {
                    int j = 0;
                    for (size_t i = 0; i < rxLen && i < sizeof(buf) && j < 255; i++) {
                        unsigned char c = buf[i];
                        ascii_buf[j++] = (c >= 0x20 && c <= 0x7E) ? c : '.';
                    }
                    ascii_buf[j] = 0;
                }

                float rssi = s_radio->getRSSI();
                int rssi_int = (int)rssi;
                ESP_LOGI(TAG_LORA, "RX data(%s): %s%d", binary_packet ? "binary" : "text", ascii_buf, rssi_int);

                lora_fill_common_record(&lora_data, "OK", rxLen, state, buf);
                snprintf(lora_data.data, sizeof(lora_data.data),
                         "%.*s0%d", 250, ascii_buf, rssi_int);
                lora_data.length = strlen(lora_data.data);
                lora_data.binary_packet = binary_packet;
                lora_data.valid_packet = true;

                if (s_lora_data_queue != NULL) {
                    if (xQueueSend(s_lora_data_queue, &lora_data, 0) != pdTRUE) {
                        s_lora_mqtt_queue_drop_count++;
                        ESP_LOGW(TAG_LORA, "MQTT queue full; dropped oldest count=%lu",
                                 (unsigned long)s_lora_mqtt_queue_drop_count);
                        lora_data_t dummy;
                        xQueueReceive(s_lora_data_queue, &dummy, 0);
                        if (xQueueSend(s_lora_data_queue, &lora_data, 0) != pdTRUE) {
                            ESP_LOGE(TAG_LORA, "MQTT queue requeue failed");
                        }
                    }
                }
                storage_manager_submit_lora(&lora_data);
            } else if (state == RADIOLIB_ERR_CRC_MISMATCH) {
                s_lora_crc_drop_count++;
                ESP_LOGW(TAG_LORA, "CRC mismatch; packet dropped count=%lu",
                         (unsigned long)s_lora_crc_drop_count);
                lora_fill_common_record(&lora_data, "CRC_ERROR", rxLen, state, buf);
                storage_manager_submit_lora(&lora_data);
            } else {
                ESP_LOGW(TAG_LORA, "readData failed: %d", state);
                lora_fill_common_record(&lora_data, "READ_ERROR", rxLen, state, buf);
                storage_manager_submit_lora(&lora_data);
            }
        } else {
            ESP_LOGW(TAG_LORA, "Invalid packet length: %zu", rxLen);
            lora_data_t lora_data;
            lora_fill_common_record(&lora_data, "BAD_LENGTH", rxLen, 0, NULL);
            storage_manager_submit_lora(&lora_data);
        }

        receive_armed = lora_start_receive_with_retry();
    }
}

esp_err_t lora_driver_init(QueueHandle_t data_queue)
{
    s_lora_data_queue = data_queue;

    ESP_LOGI(TAG_LORA, "Initializing RadioLib HAL");
    s_hal = new EspHal(LORA_SCK_PIN, LORA_MISO_PIN, LORA_MOSI_PIN, SPI2_HOST);
    ESP_LOGI(TAG_LORA, "LoRa pins: NSS=%d SCK=%d MISO=%d MOSI=%d RST=%d DIO0=%d",
             LORA_CS_PIN, LORA_SCK_PIN, LORA_MISO_PIN, LORA_MOSI_PIN, LORA_RST_PIN, LORA_DIO0_PIN);

    ESP_LOGI(TAG_LORA, "Pre-resetting SX1278 module");
    lora_prepare_module_reset();
    vTaskDelay(pdMS_TO_TICKS(20));

    ESP_LOGI(TAG_LORA, "Creating SX1278 module");
    Module *mod = new Module(s_hal, LORA_CS_PIN, LORA_DIO0_PIN, LORA_RST_PIN, RADIOLIB_NC);
    s_radio = new DriverSX1278(mod);

    ESP_LOGI(TAG_LORA, "Configuring SX1278");
    ESP_LOGI(TAG_LORA, "LoRa params: freq=433.0MHz bw=31.25kHz sf=12 cr=7 sync=0x34 power=20 preamble=12 gain=0");
    int state = s_radio->begin(433.0, 31.25, 12, 7, 0x34, 20, 12, 0);
    if (state != RADIOLIB_ERR_NONE) {
        ESP_LOGE(TAG_LORA, "SX1278 init failed: %d", state);
        return ESP_FAIL;
    }

    state = s_radio->setCRC(true);
    if (state != RADIOLIB_ERR_NONE) {
        ESP_LOGW(TAG_LORA, "setCRC failed: %d", state);
    }

    state = s_radio->explicitHeader();
    if (state != RADIOLIB_ERR_NONE) {
        ESP_LOGW(TAG_LORA, "explicitHeader failed: %d", state);
    }

    s_radio->probeRegisters("after-init");
    ESP_LOGI(TAG_LORA, "SX1278 init complete");
    vTaskDelay(pdMS_TO_TICKS(20));
    return ESP_OK;
}

esp_err_t lora_driver_start(void)
{
    BaseType_t ok = xTaskCreatePinnedToCore(
        lora_receive_task,
        "lora_receive",
        4096,
        NULL,
        5,
        &s_lora_receive_task_handle,
        1
    );

    if (ok != pdPASS) {
        ESP_LOGE(TAG_LORA, "Failed to create LoRa receive task");
        return ESP_ERR_NO_MEM;
    }

    ESP_LOGI(TAG_LORA, "LoRa receive task started");
    return ESP_OK;
}
