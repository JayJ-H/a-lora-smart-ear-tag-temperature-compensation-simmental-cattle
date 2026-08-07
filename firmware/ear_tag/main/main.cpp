#include <stdio.h>
#include <inttypes.h>
#include <math.h>
#include <string.h>
#include <stdint.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_err.h"
#include "esp_sleep.h"
#include "esp_timer.h"
#include "esp_system.h"
#include "rom/ets_sys.h"
#include "driver/gpio.h"
#include "driver/i2c_master.h"

#include "EspHal.h"

#define TAG "APP"

/* ========== Configuration ========== */
#define WAKEUP_SEC     25
#define ONE_WIRE_GPIO  GPIO_NUM_5
#define DEVICE_ID      51  // Public example; configure per device
#define DEVICE_ID_MIN  51
#define DEVICE_ID_MAX  85
#define DEVICE_CODE_BITS  6
#define DEVICE_CODE_SHIFT 18
#define DEVICE_CODE_MASK  ((1U << DEVICE_CODE_BITS) - 1U)
#define POWER_STABILIZE_DELAY_MS 500
#define LORA_TX_POWER_DBM 20
#define LORA_TX_CURRENT_LIMIT_MA 150
#define LORA_SLEEP_POWER_DBM 2
#define LORA_SLEEP_CURRENT_LIMIT_MA 60
#define RADIO_SLEEP_VERIFY_RETRIES 3

static_assert((DEVICE_ID_MAX - DEVICE_ID_MIN) <= DEVICE_CODE_MASK,
              "DEVICE_ID range exceeds LoRa packet device-code field");

/* ========== TMP117 parameters ========== */
#define TMP117_I2C_PORT       I2C_NUM_0
#define TMP117_SDA_GPIO       GPIO_NUM_35
#define TMP117_SCL_GPIO       GPIO_NUM_34
#define TMP117_I2C_ADDR       0x49
#define TMP117_REG_TEMP       0x00
#define TMP117_I2C_FREQ_HZ    100000
#define TMP117_READ_RETRIES   5
#define TMP117_RETRY_DELAY_MS 50

#define LORA_BINARY_PACKET_LEN 3
#define TEMP_TENTHS_MIN 0
#define TEMP_TENTHS_MAX 400

/* ========== RadioLib pins ========== */
#define LORA_SCK    GPIO_NUM_11     // SCK
#define LORA_MISO   GPIO_NUM_10     // MISO
#define LORA_MOSI   GPIO_NUM_9      // MOSI
#define LORA_CS     GPIO_NUM_8      // NSS
#define LORA_DIO0   GPIO_NUM_7      // DIO0, connected
#define LORA_RST    GPIO_NUM_6      // RESET
#define LORA_DIO1   RADIOLIB_NC     // DIO1 not connected

/* ========== RadioLib instance ========== */
static EspHal radioHal(
    LORA_SCK,
    LORA_MISO,
    LORA_MOSI,
    SPI2_HOST
);

class DriverSX1278 : public SX1278 {
  public:
    using SX1278::SX1278;

    void reset() override {
        Module* mod = this->getMod();
        mod->hal->pinMode(mod->getRst(), mod->hal->GpioModeOutput);
        mod->hal->digitalWrite(mod->getRst(), mod->hal->GpioLevelLow);
        mod->hal->delay(2);
        mod->hal->digitalWrite(mod->getRst(), mod->hal->GpioLevelHigh);
        mod->hal->delay(10);
    }

    bool probeVersion(const char* tag) {
        Module* mod = this->getMod();
        uint8_t version = mod->SPIreadRegister(RADIOLIB_SX127X_REG_VERSION);
        uint8_t op_mode = mod->SPIreadRegister(RADIOLIB_SX127X_REG_OP_MODE);
        uint8_t pa_config = mod->SPIreadRegister(RADIOLIB_SX127X_REG_PA_CONFIG);
        uint8_t pa_dac = mod->SPIreadRegister(RADIOLIB_SX1278_REG_PA_DAC);
        uint8_t modem_config_1 = mod->SPIreadRegister(RADIOLIB_SX127X_REG_MODEM_CONFIG_1);
        uint8_t modem_config_2 = mod->SPIreadRegister(RADIOLIB_SX127X_REG_MODEM_CONFIG_2);
        uint8_t irq_flags = mod->SPIreadRegister(RADIOLIB_SX127X_REG_IRQ_FLAGS);
        ESP_LOGI(
            TAG,
            "%s VERSION=0x%02X OP_MODE=0x%02X PA=0x%02X PA_DAC=0x%02X MC1=0x%02X MC2=0x%02X IRQ=0x%02X",
            tag,
            version,
            op_mode,
            pa_config,
            pa_dac,
            modem_config_1,
            modem_config_2,
            irq_flags
        );

        return (
            version == RADIOLIB_SX1278_CHIP_VERSION ||
            version == RADIOLIB_SX1278_CHIP_VERSION_ALT ||
            version == RADIOLIB_SX1278_CHIP_VERSION_RFM9X
        );
    }

    uint8_t readOpMode() {
        return this->getMod()->SPIreadRegister(RADIOLIB_SX127X_REG_OP_MODE);
    }

    uint8_t readIrqFlags() {
        return this->getMod()->SPIreadRegister(RADIOLIB_SX127X_REG_IRQ_FLAGS);
    }

    uint8_t readPaDac() {
        return this->getMod()->SPIreadRegister(RADIOLIB_SX1278_REG_PA_DAC);
    }

    int16_t forcePaDacOff() {
        return this->getMod()->SPIsetRegValue(
            RADIOLIB_SX1278_REG_PA_DAC,
            RADIOLIB_SX127X_PA_BOOST_OFF,
            2,
            0
        );
    }

    int16_t forcePaDacOn() {
        return this->getMod()->SPIsetRegValue(
            RADIOLIB_SX1278_REG_PA_DAC,
            RADIOLIB_SX127X_PA_BOOST_ON,
            2,
            0
        );
    }
};

DriverSX1278 radio = new Module(&radioHal, LORA_CS, LORA_DIO0, LORA_RST, LORA_DIO1);

static void configure_gpio_output(gpio_num_t pin, uint32_t level) {
    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << pin),
        .mode = GPIO_MODE_OUTPUT,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&io_conf);
    gpio_set_level(pin, level);
}

static void configure_gpio_input(gpio_num_t pin, gpio_pull_mode_t pull_mode) {
    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << pin),
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = (pull_mode == GPIO_PULLUP_ONLY) ? GPIO_PULLUP_ENABLE : GPIO_PULLUP_DISABLE,
        .pull_down_en = (pull_mode == GPIO_PULLDOWN_ONLY) ? GPIO_PULLDOWN_ENABLE : GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&io_conf);
}

static void configure_gpio_disabled(gpio_num_t pin) {
    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << pin),
        .mode = GPIO_MODE_DISABLE,
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&io_conf);
}

static void gpio_hold_dis_ignore(gpio_num_t pin) {
    esp_err_t ret = gpio_hold_dis(pin);
    if (ret != ESP_OK && ret != ESP_ERR_NOT_SUPPORTED) {
        ESP_LOGD(TAG, "gpio_hold_dis(%d) = %s", pin, esp_err_to_name(ret));
    }
}

static void gpio_hold_en_warn(gpio_num_t pin) {
    esp_err_t ret = gpio_hold_en(pin);
    if (ret != ESP_OK) {
        ESP_LOGW(TAG, "gpio_hold_en(%d) failed: %s", pin, esp_err_to_name(ret));
    }
}

static void release_deep_sleep_gpio_holds(void) {
    gpio_deep_sleep_hold_dis();

    configure_gpio_output(LORA_RST, 0);
    configure_gpio_output(LORA_CS, 1);
    configure_gpio_output(LORA_SCK, 0);
    configure_gpio_output(LORA_MOSI, 0);
    configure_gpio_input(LORA_MISO, GPIO_PULLDOWN_ONLY);
    configure_gpio_input(LORA_DIO0, GPIO_PULLDOWN_ONLY);

    gpio_hold_dis_ignore(LORA_RST);
    gpio_hold_dis_ignore(LORA_CS);
    gpio_hold_dis_ignore(LORA_SCK);
    gpio_hold_dis_ignore(LORA_MOSI);
    gpio_hold_dis_ignore(LORA_MISO);
    gpio_hold_dis_ignore(LORA_DIO0);
}

static void prepare_sensor_gpio_for_deep_sleep(void) {
    configure_gpio_disabled(ONE_WIRE_GPIO);
    configure_gpio_disabled(TMP117_SDA_GPIO);
    configure_gpio_disabled(TMP117_SCL_GPIO);
}

static void prepare_radio_gpio_for_deep_sleep(void) {
    configure_gpio_output(LORA_RST, 0);
    vTaskDelay(pdMS_TO_TICKS(2));
    configure_gpio_output(LORA_CS, 1);
    configure_gpio_output(LORA_SCK, 0);
    configure_gpio_output(LORA_MOSI, 0);
    configure_gpio_input(LORA_MISO, GPIO_PULLDOWN_ONLY);
    configure_gpio_input(LORA_DIO0, GPIO_PULLDOWN_ONLY);

    gpio_hold_en_warn(LORA_RST);
    gpio_hold_en_warn(LORA_CS);
    gpio_hold_en_warn(LORA_SCK);
    gpio_hold_en_warn(LORA_MOSI);
    gpio_hold_en_warn(LORA_MISO);
    gpio_hold_en_warn(LORA_DIO0);
    gpio_deep_sleep_hold_en();
}

static bool radio_shutdown_for_deep_sleep(bool radio_ready) {
    bool sleep_verified = !radio_ready;

    if (radio_ready) {
        int16_t limit_state = radio.setCurrentLimit(LORA_SLEEP_CURRENT_LIMIT_MA);
        if (limit_state != RADIOLIB_ERR_NONE) {
            ESP_LOGW(TAG, "Set sleep current limit failed: %d", limit_state);
        }

        int16_t power_state = radio.setOutputPower(LORA_SLEEP_POWER_DBM);
        if (power_state != RADIOLIB_ERR_NONE) {
            ESP_LOGW(TAG, "Set sleep output power failed: %d", power_state);
        }

        int16_t pa_dac_state = radio.forcePaDacOff();
        if (pa_dac_state != RADIOLIB_ERR_NONE) {
            ESP_LOGW(TAG, "Force PA_DAC off before sleep failed: %d", pa_dac_state);
        }

        for (int attempt = 1; attempt <= RADIO_SLEEP_VERIFY_RETRIES; ++attempt) {
            int16_t standby_state = radio.standby();
            if (standby_state != RADIOLIB_ERR_NONE) {
                ESP_LOGW(TAG, "radio.standby() attempt %d failed: %d", attempt, standby_state);
            }

            radio.clearIrqFlags(RADIOLIB_SX127X_FLAGS_ALL);

            int16_t sleep_state = radio.sleep();
            vTaskDelay(pdMS_TO_TICKS(2));

            uint8_t op_mode = radio.readOpMode();
            uint8_t irq_flags = radio.readIrqFlags();
            uint8_t pa_dac = radio.readPaDac();
            if (sleep_state == RADIOLIB_ERR_NONE &&
                ((op_mode & 0x07) == RADIOLIB_SX127X_SLEEP)) {
                ESP_LOGI(TAG, "Radio sleep verified: attempt=%d OP_MODE=0x%02X PA_DAC=0x%02X IRQ=0x%02X",
                         attempt, op_mode, pa_dac, irq_flags);
                sleep_verified = true;
                break;
            }

            ESP_LOGW(TAG, "Radio sleep verify failed: attempt=%d sleep=%d OP_MODE=0x%02X PA_DAC=0x%02X IRQ=0x%02X",
                     attempt, sleep_state, op_mode, pa_dac, irq_flags);
            vTaskDelay(pdMS_TO_TICKS(5));
        }

        if (!sleep_verified) {
            radio.probeVersion("sleep-verify-failed");
        }
    }

    prepare_radio_gpio_for_deep_sleep();
    prepare_sensor_gpio_for_deep_sleep();
    return sleep_verified;
}

/* ========== TMP117 readout ========== */
static i2c_master_bus_handle_t tmp117_bus = NULL;
static i2c_master_dev_handle_t tmp117_dev = NULL;

static esp_err_t tmp117_bus_init(void) {
    i2c_master_bus_config_t bus_config = {};
    bus_config.i2c_port = TMP117_I2C_PORT;
    bus_config.sda_io_num = TMP117_SDA_GPIO;
    bus_config.scl_io_num = TMP117_SCL_GPIO;
    bus_config.clk_source = I2C_CLK_SRC_DEFAULT;
    bus_config.glitch_ignore_cnt = 7;
    bus_config.flags.enable_internal_pullup = true;

    esp_err_t ret = i2c_new_master_bus(&bus_config, &tmp117_bus);
    if (ret != ESP_OK) {
        ESP_LOGW(TAG, "TMP117 I2C bus init failed: %s", esp_err_to_name(ret));
    }
    return ret;
}

static esp_err_t tmp117_init(void) {
    if (tmp117_dev != NULL) {
        return ESP_OK;
    }

    if (tmp117_bus == NULL) {
        esp_err_t ret = tmp117_bus_init();
        if (ret != ESP_OK) {
            return ret;
        }
    }

    i2c_device_config_t dev_config = {};
    dev_config.dev_addr_length = I2C_ADDR_BIT_LEN_7;
    dev_config.device_address = TMP117_I2C_ADDR;
    dev_config.scl_speed_hz = TMP117_I2C_FREQ_HZ;

    esp_err_t ret = i2c_master_bus_add_device(tmp117_bus, &dev_config, &tmp117_dev);
    if (ret != ESP_OK) {
        ESP_LOGW(TAG, "TMP117 add device 0x%02X failed: %s", TMP117_I2C_ADDR, esp_err_to_name(ret));
        return ret;
    }

    return ESP_OK;
}

static float tmp117_get_temperature_c(void) {
    esp_err_t ret = tmp117_init();
    if (ret != ESP_OK) {
        return NAN;
    }

    uint8_t reg = TMP117_REG_TEMP;
    uint8_t data[2] = {};
    for (int attempt = 1; attempt <= TMP117_READ_RETRIES; ++attempt) {
        ret = i2c_master_transmit_receive(tmp117_dev, &reg, 1, data, sizeof(data), pdMS_TO_TICKS(100));
        if (ret == ESP_OK) {
            break;
        }

        if (attempt < TMP117_READ_RETRIES) {
            vTaskDelay(pdMS_TO_TICKS(TMP117_RETRY_DELAY_MS));
        }
    }

    if (ret != ESP_OK) {
        ESP_LOGW(TAG, "TMP117 read failed after %d tries: %s", TMP117_READ_RETRIES, esp_err_to_name(ret));
        return NAN;
    }

    int16_t raw = (int16_t)((data[0] << 8) | data[1]);
    float temp_c = raw * 0.0078125f;
    ESP_LOGI(TAG, "TMP117 addr=0x%02X RAW=0x%04X -> %.2f C", TMP117_I2C_ADDR, (uint16_t)raw, temp_c);
    return temp_c;
}

static uint16_t encode_temp_tenths(float temp_c) {
    float scaled = temp_c * 10.0f;
    int tenths = 0;
    if (scaled >= 0.0f) {
        tenths = (int)(scaled + 0.5f);
    } else {
        tenths = (int)(scaled - 0.5f);
    }

    if (tenths < TEMP_TENTHS_MIN) {
        return TEMP_TENTHS_MIN;
    }
    if (tenths > TEMP_TENTHS_MAX) {
        return TEMP_TENTHS_MAX;
    }
    return (uint16_t)tenths;
}

static uint8_t encode_device_id(uint8_t device_id) {
    if (device_id < DEVICE_ID_MIN) {
        return 0;
    }
    if (device_id > DEVICE_ID_MAX) {
        return DEVICE_ID_MAX - DEVICE_ID_MIN;
    }
    return device_id - DEVICE_ID_MIN;
}

static void format_temp_tenths(char* out, size_t out_len, uint16_t tenths) {
    snprintf(out, out_len, "%u.%u", tenths / 10, tenths % 10);
}

static void encode_lora_packet(uint8_t* out, uint8_t device_id, uint16_t temp1_tenths, uint16_t temp2_tenths) {
    uint32_t packed = ((uint32_t)(encode_device_id(device_id) & DEVICE_CODE_MASK) << DEVICE_CODE_SHIFT) |
                      ((uint32_t)(temp1_tenths & 0x01FF) << 9) |
                      (uint32_t)(temp2_tenths & 0x01FF);

    out[0] = (uint8_t)((packed >> 16) & 0xFF);
    out[1] = (uint8_t)((packed >> 8) & 0xFF);
    out[2] = (uint8_t)(packed & 0xFF);
}

/* ========== 1-Wire / M1820Z interface ========== */
static void ow_gpio_init(void) {
    gpio_config_t io_conf = {
        .pin_bit_mask = (1ULL << ONE_WIRE_GPIO),
        .mode = GPIO_MODE_INPUT_OUTPUT_OD,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
    };
    gpio_config(&io_conf);
    gpio_set_level(ONE_WIRE_GPIO, 1);
    ets_delay_us(10);
}

static inline void ow_drive_low(void) { gpio_set_level(ONE_WIRE_GPIO, 0); }
static inline void ow_release(void) { gpio_set_level(ONE_WIRE_GPIO, 1); }
static inline int ow_read_pin(void) { return gpio_get_level(ONE_WIRE_GPIO); }

static int ow_reset(void) {
    ow_drive_low(); ets_delay_us(480);
    ow_release(); ets_delay_us(70);
    int presence = (ow_read_pin() == 0) ? 1 : 0;
    ets_delay_us(410);
    return presence;
}

static void ow_write_bit(int bit) {
    if (bit) { ow_drive_low(); ets_delay_us(6); ow_release(); ets_delay_us(64); }
    else     { ow_drive_low(); ets_delay_us(60); ow_release(); ets_delay_us(10); }
}

static int ow_read_bit(void) {
    int bit;
    ow_drive_low(); ets_delay_us(6); ow_release(); ets_delay_us(9);
    bit = ow_read_pin(); ets_delay_us(55);
    return bit;
}

static void ow_write_byte(uint8_t val) {
    for (int i = 0; i < 8; ++i) ow_write_bit((val >> i) & 0x01);
}

static uint8_t ow_read_byte(void) {
    uint8_t v = 0;
    for (int i = 0; i < 8; ++i) {
        int b = ow_read_bit();
        v |= (b & 0x1) << i;
    }
    return v;
}

static uint8_t dallas_crc8(const uint8_t *data, int len) {
    uint8_t crc = 0x00;
    for (int i = 0; i < len; ++i) {
        uint8_t in = data[i];
        for (int b = 0; b < 8; ++b) {
            uint8_t mix = (crc ^ in) & 0x01;
            crc >>= 1;
            if (mix) crc ^= 0x8C;
            in >>= 1;
        }
    }
    return crc;
}

static float m1820z_get_temperature_c(void) {
    uint8_t sp[9];
    if (!ow_reset()) { ESP_LOGW(TAG, "M1820Z not present (reset fail)"); return NAN; }
    ow_write_byte(0xCC); ow_write_byte(0x44);
    const int timeout_ms = 400; int waited = 0;
    while (waited < timeout_ms) {
        if (ow_read_bit()) break;
        vTaskDelay(pdMS_TO_TICKS(2)); waited += 2;
    }
    if (waited >= timeout_ms) ESP_LOGW(TAG, "M1820Z convert timeout");
    if (!ow_reset()) { ESP_LOGW(TAG, "M1820Z not present"); return NAN; }
    ow_write_byte(0xCC); ow_write_byte(0xBE);
    for (int i = 0; i < 9; ++i) sp[i] = ow_read_byte();
    uint8_t crc = dallas_crc8(sp, 8);
    if (crc != sp[8]) {
        ESP_LOGW(TAG, "CRC mismatch: calc=0x%02X, sp[8]=0x%02X", crc, sp[8]);
        return NAN;
    }
    int16_t raw = (int16_t)((sp[1] << 8) | sp[0]);
    float temp_c = (raw / 256.0f) + 40.0f;
    ESP_LOGI(TAG, "SP0=0x%02X SP1=0x%02X RAW=0x%04X -> %.2f C", sp[0], sp[1], (uint16_t)raw, temp_c);
    return temp_c;
}

/* ========== app_main ========== */
extern "C" void app_main(void) {
    ESP_LOGI(TAG, "Start");
    ESP_LOGI(TAG, "Wakeup causes = 0x%llX", esp_sleep_get_wakeup_causes());
    ESP_LOGI(TAG, "Reset reason = %d", esp_reset_reason());
    release_deep_sleep_gpio_holds();

    ESP_LOGI(TAG, "Wait %d ms for external power to stabilize", POWER_STABILIZE_DELAY_MS);
    vTaskDelay(pdMS_TO_TICKS(POWER_STABILIZE_DELAY_MS));

    ow_gpio_init();
    bool radio_ready = false;
    int state = RADIOLIB_ERR_UNKNOWN;

    // Initialize with receiver settings to keep link parameters aligned.
    state = radio.begin(
        433.0,     // Frequency in MHz
        31.25,     // BW kHz
        12,        // SF=12
        7,         // CR=4/7
        0x34,      // SyncWord
        LORA_TX_POWER_DBM,
        12,        // Preamble
        0          // Gain auto
    );

    if (state != RADIOLIB_ERR_NONE) {
        ESP_LOGE(TAG, "Radio init failed! code = %d", state);
    } else {
        state = radio.setCRC(true);
        if (state != RADIOLIB_ERR_NONE) {
            ESP_LOGW(TAG, "Enable CRC failed, code = %d", state);
        }

        state = radio.explicitHeader();
        if (state != RADIOLIB_ERR_NONE) {
            ESP_LOGW(TAG, "Set explicit header failed, code = %d", state);
        }

        state = radio.setCurrentLimit(LORA_TX_CURRENT_LIMIT_MA);
        if (state != RADIOLIB_ERR_NONE) {
            ESP_LOGW(TAG, "Set TX current limit failed, code = %d", state);
        }

        state = radio.forcePaDacOn();
        if (state != RADIOLIB_ERR_NONE) {
            ESP_LOGW(TAG, "Force PA_DAC on after init failed, code = %d", state);
        }

        radio.probeVersion("after-init");
        radio_ready = true;
        ESP_LOGI(TAG, "RadioLib init OK: freq=433.0 bw=31.25 sf=12 cr=7 sync=0x34 power=%d preamble=12 ocp=%d",
                 LORA_TX_POWER_DBM, LORA_TX_CURRENT_LIMIT_MA);
    }

    if (radio_ready) {
        float temp = m1820z_get_temperature_c();
        if (isnan(temp)) {
            ESP_LOGW(TAG, "M1820Z read failed, use 0.0");
            temp = 0.0f;
        } else {
            ESP_LOGI(TAG, "M1820Z Temperature: %.2f C", temp);
        }

        float tmp117_temp = tmp117_get_temperature_c();
        if (isnan(tmp117_temp)) {
            ESP_LOGW(TAG, "TMP117 read failed, use 0.0");
            tmp117_temp = 0.0f;
        } else {
            ESP_LOGI(TAG, "TMP117 Temperature: %.2f C", tmp117_temp);
        }

        uint16_t temp_tenths = encode_temp_tenths(temp);
        uint16_t tmp117_temp_tenths = encode_temp_tenths(tmp117_temp);

        char temp_preview[16] = {};
        char tmp117_temp_preview[16] = {};
        format_temp_tenths(temp_preview, sizeof(temp_preview), temp_tenths);
        format_temp_tenths(tmp117_temp_preview, sizeof(tmp117_temp_preview), tmp117_temp_tenths);

        char message_preview[48];
        snprintf(message_preview, sizeof(message_preview), "%dn%st%s", DEVICE_ID, temp_preview, tmp117_temp_preview);

        uint8_t message[LORA_BINARY_PACKET_LEN] = {};
        encode_lora_packet(message, DEVICE_ID, temp_tenths, tmp117_temp_tenths);

        ESP_LOGI(TAG, "Sending binary (%d bytes): %s", LORA_BINARY_PACKET_LEN, message_preview);

        int64_t tx_start_us = esp_timer_get_time();
        state = radio.transmit(message, sizeof(message));
        int64_t tx_elapsed_ms = (esp_timer_get_time() - tx_start_us) / 1000;
        if (state == RADIOLIB_ERR_NONE) {
            ESP_LOGI(TAG, "Send success, elapsed=%lld ms", tx_elapsed_ms);
        } else {
            ESP_LOGE(TAG, "Send failed, code = %d, elapsed=%lld ms", state, tx_elapsed_ms);
            radio.probeVersion("after-tx-failed");
        }
    }

    if (!radio_shutdown_for_deep_sleep(radio_ready)) {
        ESP_LOGW(TAG, "Radio sleep was not verified; RST is held low for deep sleep");
    }

    esp_sleep_enable_timer_wakeup((uint64_t)WAKEUP_SEC * 1000000ULL);
    ESP_LOGI(TAG, "Deep sleep for %d seconds", WAKEUP_SEC);
    esp_deep_sleep_start();
}
