#include "time_utils.h"

#include <stdio.h>
#include <string.h>
#include <sys/time.h>
#include <time.h>

#include "esp_log.h"
#include "esp_random.h"

static uint32_t s_boot_id = 0;

void time_utils_init(void)
{
    if (s_boot_id != 0) {
        return;
    }

    uint32_t random_part = esp_random() & 0xFFFF;
    uint32_t tick_part = (uint32_t)(esp_log_timestamp() & 0xFFFF);
    s_boot_id = (tick_part << 16) | random_part;
    if (s_boot_id == 0) {
        s_boot_id = 1;
    }
}

uint32_t time_utils_boot_id(void)
{
    time_utils_init();
    return s_boot_id;
}

void time_utils_get_timestamp(timestamp_info_t *info)
{
    if (info == NULL) {
        return;
    }

    time_utils_init();
    memset(info, 0, sizeof(*info));
    info->boot_id = s_boot_id;

    struct timeval tv = {};
    gettimeofday(&tv, NULL);
    info->epoch = (uint64_t)tv.tv_sec;

    if (tv.tv_sec >= 1700000000) {
        info->time_valid = true;
        snprintf(info->time_source, sizeof(info->time_source), "NETWORK");

        struct tm tm_utc = {};
        gmtime_r(&tv.tv_sec, &tm_utc);
        strftime(info->text, sizeof(info->text), "%Y-%m-%dT%H:%M:%SZ", &tm_utc);
    } else {
        info->time_valid = false;
        snprintf(info->time_source, sizeof(info->time_source), "BOOT");
        snprintf(info->text, sizeof(info->text), "BOOT+%lums", (unsigned long)esp_log_timestamp());
    }
}
