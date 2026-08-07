#ifndef LORA_DRIVER_H
#define LORA_DRIVER_H

#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

#define LORA_RAW_HEX_SIZE 512

typedef struct {
    char data[255];
    int length;
    uint32_t tick_ms;
    uint64_t rx_epoch;
    uint32_t boot_id;
    uint32_t irq_count;
    uint16_t raw_len;
    int16_t read_state;
    int16_t rssi_tenths;
    int16_t snr_tenths;
    int16_t freq_error_hz;
    bool time_valid;
    bool binary_packet;
    bool valid_packet;
    char rx_time[32];
    char time_source[8];
    char status[16];
    char raw_hex[LORA_RAW_HEX_SIZE];
} lora_data_t;

esp_err_t lora_driver_init(QueueHandle_t data_queue);
esp_err_t lora_driver_start(void);

#ifdef __cplusplus
}
#endif

#endif
