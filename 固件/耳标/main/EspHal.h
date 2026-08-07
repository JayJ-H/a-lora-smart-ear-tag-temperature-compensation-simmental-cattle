#ifndef ESP_HAL_H
#define ESP_HAL_H

#include <RadioLib.h>

#if CONFIG_IDF_TARGET_ESP32S3 == 0
  #error This HAL only supports ESP32-S3 targets.
#endif

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/gpio.h"
#include "driver/spi_master.h"
#include "esp_timer.h"
#include "esp_log.h"
#include "sdkconfig.h"

#define LOW                         (0x0)
#define HIGH                        (0x1)
#define INPUT                       (GPIO_MODE_INPUT)
#define OUTPUT                      (GPIO_MODE_OUTPUT)
#define RISING                      (GPIO_INTR_POSEDGE)
#define FALLING                     (GPIO_INTR_NEGEDGE)
#define NOP()                       asm volatile ("nop")

class EspHal : public RadioLibHal {
  public:
    EspHal(int8_t sck, int8_t miso, int8_t mosi, spi_host_device_t spiHost = SPI2_HOST)
      : RadioLibHal(INPUT, OUTPUT, LOW, HIGH, RISING, FALLING),
        spiSCK(sck),
        spiMISO(miso),
        spiMOSI(mosi),
        spiHost(spiHost) {
      spiDevice = NULL;
      spiBusInitialized = false;
    }

    void init() override {
      spi_bus_config_t buscfg = {};
      buscfg.mosi_io_num = spiMOSI;
      buscfg.miso_io_num = spiMISO;
      buscfg.sclk_io_num = spiSCK;
      buscfg.quadwp_io_num = -1;
      buscfg.quadhd_io_num = -1;
      buscfg.data4_io_num = -1;
      buscfg.data5_io_num = -1;
      buscfg.data6_io_num = -1;
      buscfg.data7_io_num = -1;
      buscfg.max_transfer_sz = 4096;
      buscfg.flags = 0;
      buscfg.intr_flags = 0;

      esp_err_t ret = spi_bus_initialize(spiHost, &buscfg, SPI_DMA_CH_AUTO);
      if(ret == ESP_ERR_INVALID_STATE) {
        ESP_LOGD("EspHal", "SPI bus already initialized, skipping");
        spiBusInitialized = true;
        return;
      } else if(ret != ESP_OK) {
        ESP_LOGE("EspHal", "SPI bus initialization failed: %s", esp_err_to_name(ret));
        return;
      }

      spiBusInitialized = true;
    }

    void term() override {
      if(spiDevice) {
        spi_bus_remove_device(spiDevice);
        spiDevice = NULL;
      }

      if(spiBusInitialized) {
        spi_bus_free(spiHost);
        spiBusInitialized = false;
      }
    }

    void pinMode(uint32_t pin, uint32_t mode) override {
      if(pin == RADIOLIB_NC) {
        return;
      }

      gpio_config_t conf = {
        .pin_bit_mask = (1ULL << pin),
        .mode = static_cast<gpio_mode_t>(mode),
        .pull_up_en = GPIO_PULLUP_DISABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_DISABLE,
      };
      gpio_config(&conf);
    }

    void digitalWrite(uint32_t pin, uint32_t value) override {
      if(pin == RADIOLIB_NC) {
        return;
      }

      gpio_set_level(static_cast<gpio_num_t>(pin), value);
    }

    uint32_t digitalRead(uint32_t pin) override {
      if(pin == RADIOLIB_NC) {
        return 0;
      }

      return gpio_get_level(static_cast<gpio_num_t>(pin));
    }

    void attachInterrupt(uint32_t interruptNum, void (*interruptCb)(void), uint32_t mode) override {
      if(interruptNum == RADIOLIB_NC) {
        return;
      }

      esp_err_t ret = gpio_install_isr_service(0);
      if((ret != ESP_OK) && (ret != ESP_ERR_INVALID_STATE)) {
        ESP_LOGE("EspHal", "GPIO ISR service init failed: %s", esp_err_to_name(ret));
        return;
      }

      gpio_set_intr_type(static_cast<gpio_num_t>(interruptNum), static_cast<gpio_int_type_t>(mode));
      gpio_isr_handler_add(static_cast<gpio_num_t>(interruptNum), reinterpret_cast<void (*)(void*)>(interruptCb), NULL);
    }

    void detachInterrupt(uint32_t interruptNum) override {
      if(interruptNum == RADIOLIB_NC) {
        return;
      }

      gpio_isr_handler_remove(static_cast<gpio_num_t>(interruptNum));
      gpio_set_intr_type(static_cast<gpio_num_t>(interruptNum), GPIO_INTR_DISABLE);
    }

    void delay(unsigned long ms) override {
      vTaskDelay(ms / portTICK_PERIOD_MS);
    }

    void yield() override {
      taskYIELD();
    }

    void delayMicroseconds(unsigned long us) override {
      uint64_t m = static_cast<uint64_t>(esp_timer_get_time());
      if(us) {
        uint64_t e = m + us;
        if(m > e) {
          while(static_cast<uint64_t>(esp_timer_get_time()) > e) {
            NOP();
          }
        }
        while(static_cast<uint64_t>(esp_timer_get_time()) < e) {
          NOP();
        }
      }
    }

    unsigned long millis() override {
      return static_cast<unsigned long>(esp_timer_get_time() / 1000ULL);
    }

    unsigned long micros() override {
      return static_cast<unsigned long>(esp_timer_get_time());
    }

    long pulseIn(uint32_t pin, uint32_t state, unsigned long timeout) override {
      if(pin == RADIOLIB_NC) {
        return 0;
      }

      this->pinMode(pin, INPUT);
      uint32_t start = this->micros();
      uint32_t curtick = this->micros();

      while(this->digitalRead(pin) == state) {
        if((this->micros() - curtick) > timeout) {
          return 0;
        }
      }

      return this->micros() - start;
    }

    void spiBegin() override {
    }

    void spiBeginTransaction() override {
      if(!spiBusInitialized) {
        ESP_LOGE("EspHal", "SPI bus not initialized");
        return;
      }

      if(spiDevice == NULL) {
        spi_device_interface_config_t devcfg = {};
        devcfg.clock_speed_hz = 200000;
        devcfg.mode = 0;
        devcfg.spics_io_num = -1;
        devcfg.queue_size = 1;
        devcfg.flags = 0;
        devcfg.pre_cb = NULL;

        esp_err_t ret = spi_bus_add_device(spiHost, &devcfg, &spiDevice);
        if(ret != ESP_OK) {
          ESP_LOGE("EspHal", "SPI device add failed: %s", esp_err_to_name(ret));
          return;
        }
      }
    }

    void spiTransfer(uint8_t* out, size_t len, uint8_t* in) override {
      if(spiDevice) {
        spi_transaction_t t = {};
        t.length = len * 8;
        t.tx_buffer = out;
        t.rx_buffer = in;

        delayMicroseconds(2);
        esp_err_t ret = spi_device_transmit(spiDevice, &t);
        if(ret != ESP_OK) {
          ESP_LOGE("EspHal", "SPI transfer failed: %s", esp_err_to_name(ret));
        }
        delayMicroseconds(2);
      }
    }

    void spiEndTransaction() override {
    }

    void spiEnd() override {
    }

  private:
    int8_t spiSCK;
    int8_t spiMISO;
    int8_t spiMOSI;
    spi_host_device_t spiHost;
    spi_device_handle_t spiDevice;
    bool spiBusInitialized;
};

#endif
