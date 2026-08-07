#ifndef TIME_UTILS_H
#define TIME_UTILS_H

#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    uint32_t boot_id;
    uint64_t epoch;
    bool time_valid;
    char time_source[8];
    char text[32];
} timestamp_info_t;

void time_utils_init(void);
uint32_t time_utils_boot_id(void);
void time_utils_get_timestamp(timestamp_info_t *info);

#ifdef __cplusplus
}
#endif

#endif
