#include "sx1278_probe.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "driver/gpio.h"
#include "esp_log.h"

#include "RadioLib.h"
#include "EspHal.h"

static const char *TAG_PROBE = "LORA_PROBE";

#define LORA_SCK_PIN  11
#define LORA_MISO_PIN 10
#define LORA_MOSI_PIN 9
#define LORA_CS_PIN   8
#define LORA_RST_PIN  6

static void probe_reset_module(void)
{
    gpio_config_t rst_cfg = {};
    rst_cfg.pin_bit_mask = (1ULL << LORA_RST_PIN);
    rst_cfg.mode = GPIO_MODE_OUTPUT;
    rst_cfg.pull_up_en = GPIO_PULLUP_DISABLE;
    rst_cfg.pull_down_en = GPIO_PULLDOWN_DISABLE;
    rst_cfg.intr_type = GPIO_INTR_DISABLE;
    gpio_config(&rst_cfg);

    ESP_LOGI(TAG_PROBE, "RST 拉低...");
    gpio_set_level((gpio_num_t)LORA_RST_PIN, 0);
    vTaskDelay(pdMS_TO_TICKS(10));

    ESP_LOGI(TAG_PROBE, "RST 拉高...");
    gpio_set_level((gpio_num_t)LORA_RST_PIN, 1);
    vTaskDelay(pdMS_TO_TICKS(20));
}

static void probe_version(Module *mod, const char *tag)
{
    uint8_t version = mod->SPIreadRegister(RADIOLIB_SX127X_REG_VERSION);
    uint8_t op_mode = mod->SPIreadRegister(RADIOLIB_SX127X_REG_OP_MODE);
    ESP_LOGI(TAG_PROBE, "%s VERSION=0x%02X OP_MODE=0x%02X", tag, version, op_mode);
}

class ProbeSX1278 : public SX1278 {
  public:
    using SX1278::SX1278;

    void reset() override
    {
        Module *mod = this->getMod();
        ESP_LOGI(TAG_PROBE, "RadioLib reset: RST 拉低...");
        mod->hal->pinMode(mod->getRst(), mod->hal->GpioModeOutput);
        mod->hal->digitalWrite(mod->getRst(), mod->hal->GpioLevelLow);
        mod->hal->delay(20);

        ESP_LOGI(TAG_PROBE, "RadioLib reset: RST 拉高...");
        mod->hal->digitalWrite(mod->getRst(), mod->hal->GpioLevelHigh);
        mod->hal->delay(50);
    }
};

void sx1278_probe_run(void)
{
    ESP_LOGI(TAG_PROBE, "SX1278 最小探针启动");

    EspHal *hal = new EspHal(LORA_SCK_PIN, LORA_MISO_PIN, LORA_MOSI_PIN, SPI2_HOST);
    Module *mod = new Module(hal, LORA_CS_PIN, RADIOLIB_NC, LORA_RST_PIN, RADIOLIB_NC);

    ESP_LOGI(TAG_PROBE, "初始化模块基础设施...");
    mod->init();

    probe_reset_module();

    bool recognized = false;
    for (int i = 1; i <= 8; ++i) {
        char label[32];
        snprintf(label, sizeof(label), "probe-%d", i);
        probe_version(mod, label);
        uint8_t version = mod->SPIreadRegister(RADIOLIB_SX127X_REG_VERSION);
        if (version == RADIOLIB_SX1278_CHIP_VERSION ||
            version == RADIOLIB_SX1278_CHIP_VERSION_ALT ||
            version == RADIOLIB_SX1278_CHIP_VERSION_RFM9X) {
            recognized = true;
            break;
        }
        vTaskDelay(pdMS_TO_TICKS(20));
    }

    if (recognized) {
        ESP_LOGI(TAG_PROBE, "识别成功：版本寄存器匹配 SX1278");
    } else {
        ESP_LOGE(TAG_PROBE, "识别失败：版本寄存器始终未匹配 SX1278");
    }

    if (!recognized) {
        while (1) {
            vTaskDelay(pdMS_TO_TICKS(1000));
        }
    }

    ESP_LOGI(TAG_PROBE, "开始执行 SX1278 初始化...");
    ProbeSX1278 radio(mod);
    int state = radio.begin(433.0, 31.25, 12, 7, 0x34, 20, 12, 0);
    ESP_LOGI(TAG_PROBE, "radio.begin() 结果: %d", state);
    if (state != RADIOLIB_ERR_NONE) {
        ESP_LOGE(TAG_PROBE, "SX1278 初始化失败: %d", state);
        while (1) {
            vTaskDelay(pdMS_TO_TICKS(1000));
        }
    }

    state = radio.setCRC(true);
    ESP_LOGI(TAG_PROBE, "setCRC(true) 结果: %d", state);

    state = radio.explicitHeader();
    ESP_LOGI(TAG_PROBE, "explicitHeader() 结果: %d", state);

    probe_version(mod, "after-init");
    ESP_LOGI(TAG_PROBE, "SX1278 初始化完成");

    while (1) {
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}
