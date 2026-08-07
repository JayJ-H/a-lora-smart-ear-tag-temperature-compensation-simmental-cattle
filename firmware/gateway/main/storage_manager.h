#ifndef STORAGE_MANAGER_H
#define STORAGE_MANAGER_H

#include "esp_err.h"
#include "lora_driver.h"

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t storage_manager_start(void);
void storage_manager_submit_lora(const lora_data_t *data);
void storage_manager_submit_event(const char *event, const char *detail);

#ifdef __cplusplus
}
#endif

#endif
