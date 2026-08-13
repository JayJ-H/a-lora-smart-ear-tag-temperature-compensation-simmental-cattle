#include "storage_manager.h"

#include <stdlib.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <time.h>
#include <unistd.h>

#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"

#include "driver/usb_serial_jtag.h"
#include "esp_intr_alloc.h"
#include "esp_log.h"
#include "sdkconfig.h"
#include "time_utils.h"

#if CONFIG_LORA_ENABLE_USB_MSC_STORAGE
#include "esp_vfs_fat.h"
#include "usb/msc_host_vfs.h"
#include "usb/usb_host.h"
#endif

static const char *TAG_STORAGE = "STORAGE";

#define STORAGE_DETECT_WINDOW_MS 5000
#define STORAGE_QUEUE_DEPTH 16
#define STORAGE_USB_WRITE_TIMEOUT_MS 20
#define STORAGE_USB_DISK_RETRY_MS 5000
#define STORAGE_USB_DISK_WARN_INTERVAL_MS 30000
#define STORAGE_USB_MOUNT_PATH "/usb0"
#define STORAGE_USB_FULL_LOG_PATH STORAGE_USB_MOUNT_PATH "/LORA_ALL.CSV"
#define STORAGE_USB_VALID_LOG_PATH_PRIMARY STORAGE_USB_MOUNT_PATH "/LORA_VALID.CSV"
#define STORAGE_USB_VALID_LOG_PATH_FALLBACK STORAGE_USB_MOUNT_PATH "/VALID.CSV"
#define STORAGE_USB_EVENT_LOG_PATH STORAGE_USB_MOUNT_PATH "/EVENT.CSV"
#define STORAGE_USB_MAX_OPEN_FILES 4
#define STORAGE_USB_RECONNECT_SETTLE_MS 1000
#define STORAGE_OFFLINE_BUFFER_DEPTH 64
#define STORAGE_USB_FULL_HEADER "tick_ms,rx_tick_ms,rx_time,time_source,time_valid,boot_id,status,valid,binary,raw_len,read_state,rssi_dbm,snr_db,freq_error_hz,irq_count,data,raw_hex\r\n"
#define STORAGE_USB_VALID_HEADER "tick_ms,rx_tick_ms,rx_time,time_source,time_valid,boot_id,event,data,rssi_dbm,snr_db,freq_error_hz,irq_count,raw_len,raw_hex\r\n"
#define STORAGE_USB_EVENT_HEADER "tick_ms,event_time,time_source,time_valid,boot_id,event,detail\r\n"
#define STORAGE_USB_SYNC_EVERY_ROWS 5
#define STORAGE_USB_SYNC_INTERVAL_MS 1000

typedef enum {
    STORAGE_RECORD_LORA = 0,
    STORAGE_RECORD_EVENT,
} storage_record_type_t;

typedef struct {
    char event[32];
    char detail[96];
} storage_event_record_t;

typedef struct {
    storage_record_type_t type;
    union {
        lora_data_t lora;
        storage_event_record_t event;
    } payload;
} storage_record_t;

typedef enum {
    STORAGE_MODE_DETECTING = 0,
    STORAGE_MODE_PC_LOG,
    STORAGE_MODE_USB_DISK_WAIT,
    STORAGE_MODE_USB_DISK,
    STORAGE_MODE_RAM_ONLY,
} storage_mode_t;

static QueueHandle_t s_storage_queue = NULL;
static storage_mode_t s_storage_mode = STORAGE_MODE_DETECTING;
static bool s_usb_jtag_driver_owned = false;
static uint32_t s_ram_only_dropped = 0;
static uint32_t s_storage_queue_drop_count = 0;
static SemaphoreHandle_t s_offline_buffer_mutex = NULL;
static lora_data_t s_offline_buffer[STORAGE_OFFLINE_BUFFER_DEPTH];
static uint16_t s_offline_buffer_head = 0;
static uint16_t s_offline_buffer_count = 0;
static uint32_t s_offline_buffer_overwrite_count = 0;

#if CONFIG_LORA_ENABLE_USB_MSC_STORAGE
typedef enum {
    STORAGE_USB_EVENT_CONNECTED = 0,
    STORAGE_USB_EVENT_DISCONNECTED,
} storage_usb_event_id_t;

typedef struct {
    storage_usb_event_id_t id;
    uint8_t address;
    msc_host_device_handle_t device_handle;
} storage_usb_event_t;

static QueueHandle_t s_usb_event_queue = NULL;
static TaskHandle_t s_usb_host_task_handle = NULL;
static bool s_usb_host_task_started = false;
static bool s_usb_host_ready = false;
static bool s_usb_disk_ready = false;
static uint8_t s_usb_disk_address = 0;
static msc_host_device_handle_t s_usb_msc_device = NULL;
static msc_host_vfs_handle_t s_usb_msc_vfs = NULL;
static FILE *s_usb_full_log_file = NULL;
static FILE *s_usb_valid_log_file = NULL;
static FILE *s_usb_event_log_file = NULL;
static uint32_t s_usb_mount_count = 0;
static uint32_t s_usb_unmount_count = 0;
static uint32_t s_usb_write_fail_count = 0;
static uint32_t s_usb_rows_since_sync = 0;
static TickType_t s_usb_last_cleanup_tick = 0;
static TickType_t s_usb_last_sync_tick = 0;
static bool s_usb_loss_marker_pending = false;
static timestamp_info_t s_usb_loss_marker_ts = {};
static const char *s_usb_valid_log_path = STORAGE_USB_VALID_LOG_PATH_PRIMARY;
static bool s_usb_valid_log_using_fallback = false;
#endif

static const char *storage_mode_name(storage_mode_t mode)
{
    switch (mode) {
    case STORAGE_MODE_DETECTING:
        return "detecting";
    case STORAGE_MODE_PC_LOG:
        return "pc-log";
    case STORAGE_MODE_USB_DISK_WAIT:
        return "usb-disk-wait";
    case STORAGE_MODE_USB_DISK:
        return "usb-disk";
    case STORAGE_MODE_RAM_ONLY:
        return "ram-only";
    default:
        return "unknown";
    }
}

static void storage_drop_mirror(void)
{
    s_ram_only_dropped++;
    if ((s_ram_only_dropped % 50) == 1) {
        ESP_LOGW(TAG_STORAGE, "offline storage unavailable; dropped mirror count=%lu",
                 (unsigned long)s_ram_only_dropped);
    }
}

static void storage_offline_buffer_push(const lora_data_t *data)
{
    if (data == NULL) {
        return;
    }

    if (s_offline_buffer_mutex != NULL) {
        xSemaphoreTake(s_offline_buffer_mutex, portMAX_DELAY);
    }

    uint16_t write_index = 0;
    if (s_offline_buffer_count < STORAGE_OFFLINE_BUFFER_DEPTH) {
        write_index = (uint16_t)((s_offline_buffer_head + s_offline_buffer_count) %
                                 STORAGE_OFFLINE_BUFFER_DEPTH);
        s_offline_buffer_count++;
    } else {
        write_index = s_offline_buffer_head;
        s_offline_buffer_head = (uint16_t)((s_offline_buffer_head + 1) %
                                           STORAGE_OFFLINE_BUFFER_DEPTH);
        s_offline_buffer_overwrite_count++;
        if ((s_offline_buffer_overwrite_count % 50) == 1) {
            ESP_LOGW(TAG_STORAGE, "offline buffer full; overwritten oldest count=%lu",
                     (unsigned long)s_offline_buffer_overwrite_count);
        }
    }

    s_offline_buffer[write_index] = *data;

    if (s_offline_buffer_mutex != NULL) {
        xSemaphoreGive(s_offline_buffer_mutex);
    }
}

static bool storage_offline_buffer_pop(lora_data_t *data)
{
    if (data == NULL) {
        return false;
    }

    if (s_offline_buffer_mutex != NULL) {
        xSemaphoreTake(s_offline_buffer_mutex, portMAX_DELAY);
    }

    if (s_offline_buffer_count == 0) {
        if (s_offline_buffer_mutex != NULL) {
            xSemaphoreGive(s_offline_buffer_mutex);
        }
        return false;
    }

    *data = s_offline_buffer[s_offline_buffer_head];
    s_offline_buffer_head = (uint16_t)((s_offline_buffer_head + 1) %
                                       STORAGE_OFFLINE_BUFFER_DEPTH);
    s_offline_buffer_count--;

    if (s_offline_buffer_mutex != NULL) {
        xSemaphoreGive(s_offline_buffer_mutex);
    }
    return true;
}

static void storage_pc_log_write(const lora_data_t *data)
{
    char line[320];
    int len = snprintf(line, sizeof(line), "LORA_DATA,%s\r\n", data->data);
    if (len <= 0) {
        return;
    }
    if (len >= (int)sizeof(line)) {
        len = sizeof(line) - 1;
    }

    int written = usb_serial_jtag_write_bytes(line, (size_t)len, pdMS_TO_TICKS(STORAGE_USB_WRITE_TIMEOUT_MS));
    if (written <= 0) {
        ESP_LOGD(TAG_STORAGE, "USB serial log write skipped");
    }
}

static bool storage_usb_serial_jtag_ensure_started(void)
{
    if (usb_serial_jtag_is_driver_installed()) {
        return true;
    }

    usb_serial_jtag_driver_config_t cfg = USB_SERIAL_JTAG_DRIVER_CONFIG_DEFAULT();
    esp_err_t err = usb_serial_jtag_driver_install(&cfg);
    if (err == ESP_OK) {
        s_usb_jtag_driver_owned = true;
        return true;
    }

    if (err != ESP_ERR_INVALID_STATE) {
        ESP_LOGW(TAG_STORAGE, "USB serial/JTAG driver install failed: %s", esp_err_to_name(err));
    }
    return false;
}

#if CONFIG_LORA_ENABLE_USB_MSC_STORAGE
static bool storage_usb_sync_file(FILE *file, const char *path)
{
    if (file == NULL) {
        return true;
    }

    bool ok = true;
    if (fflush(file) != 0) {
        ESP_LOGE(TAG_STORAGE, "failed to flush %s: errno=%d", path, errno);
        ok = false;
    }

    int fd = fileno(file);
    if (fd >= 0 && fsync(fd) != 0) {
        ESP_LOGE(TAG_STORAGE, "failed to sync %s: errno=%d", path, errno);
        ok = false;
    }
    return ok;
}

static bool storage_usb_sync_logs(bool force)
{
    TickType_t now = xTaskGetTickCount();
    if (!force &&
        s_usb_rows_since_sync < STORAGE_USB_SYNC_EVERY_ROWS &&
        (now - s_usb_last_sync_tick) < pdMS_TO_TICKS(STORAGE_USB_SYNC_INTERVAL_MS)) {
        return true;
    }

    bool ok = storage_usb_sync_file(s_usb_full_log_file, STORAGE_USB_FULL_LOG_PATH);
    ok = storage_usb_sync_file(s_usb_valid_log_file, s_usb_valid_log_path) && ok;
    ok = storage_usb_sync_file(s_usb_event_log_file, STORAGE_USB_EVENT_LOG_PATH) && ok;
    if (ok) {
        s_usb_rows_since_sync = 0;
        s_usb_last_sync_tick = now;
    }
    return ok;
}

static void storage_close_usb_logs(void)
{
    storage_usb_sync_logs(true);

    if (s_usb_full_log_file != NULL) {
        fclose(s_usb_full_log_file);
        s_usb_full_log_file = NULL;
    }
    if (s_usb_valid_log_file != NULL) {
        fclose(s_usb_valid_log_file);
        s_usb_valid_log_file = NULL;
    }
    if (s_usb_event_log_file != NULL) {
        fclose(s_usb_event_log_file);
        s_usb_event_log_file = NULL;
    }
    s_usb_rows_since_sync = 0;
    s_usb_valid_log_path = STORAGE_USB_VALID_LOG_PATH_PRIMARY;
    s_usb_valid_log_using_fallback = false;
}

static void storage_usb_cleanup_device(const char *reason, bool remember_loss = true)
{
    if (remember_loss && s_usb_disk_ready) {
        time_utils_get_timestamp(&s_usb_loss_marker_ts);
        s_usb_loss_marker_pending = true;
    }

    storage_close_usb_logs();

    if (s_usb_msc_vfs != NULL) {
        esp_err_t err = msc_host_vfs_unregister(s_usb_msc_vfs);
        if (err != ESP_OK) {
            ESP_LOGW(TAG_STORAGE, "msc_host_vfs_unregister during cleanup failed: %s",
                     esp_err_to_name(err));
        }
        s_usb_msc_vfs = NULL;
    }

    if (s_usb_msc_device != NULL) {
        esp_err_t err = msc_host_uninstall_device(s_usb_msc_device);
        if (err != ESP_OK) {
            ESP_LOGW(TAG_STORAGE, "msc_host_uninstall_device during cleanup failed: %s",
                     esp_err_to_name(err));
        }
        s_usb_msc_device = NULL;
    }

    if (s_usb_disk_ready) {
        s_usb_unmount_count++;
    }
    s_usb_disk_ready = false;
    s_usb_disk_address = 0;
    s_usb_last_cleanup_tick = xTaskGetTickCount();

    ESP_LOGW(TAG_STORAGE, "USB disk cleanup: %s mount_count=%lu unmount_count=%lu write_fail=%lu",
             reason != NULL ? reason : "unknown",
             (unsigned long)s_usb_mount_count,
             (unsigned long)s_usb_unmount_count,
             (unsigned long)s_usb_write_fail_count);
}

static void storage_usb_write_csv_field(FILE *file, const char *value)
{
    fputc('"', file);
    for (const char *p = value; p != NULL && *p != '\0'; ++p) {
        if (*p == '"') {
            fputc('"', file);
        }
        fputc(*p, file);
    }
    fputc('"', file);
}

static void storage_usb_make_backup_path(const char *path, char *out, size_t out_len)
{
    timestamp_info_t ts = {};
    time_utils_get_timestamp(&ts);
    snprintf(out, out_len, "%s.old-%08lX-%lu",
             path,
             (unsigned long)ts.boot_id,
             (unsigned long)esp_log_timestamp());
}

static bool storage_usb_header_matches(const char *path, const char *header)
{
    FILE *file = fopen(path, "r");
    if (file == NULL) {
        return false;
    }

    char first_line[320] = {};
    char *line = fgets(first_line, sizeof(first_line), file);
    fclose(file);
    if (line == NULL) {
        return false;
    }

    return strcmp(first_line, header) == 0;
}

static bool storage_usb_prepare_log_file(const char *path, const char *header)
{
    struct stat st = {};
    if (stat(path, &st) != 0 || st.st_size == 0) {
        return true;
    }

    if (storage_usb_header_matches(path, header)) {
        return true;
    }

    char backup_path[160] = {};
    storage_usb_make_backup_path(path, backup_path, sizeof(backup_path));
    if (rename(path, backup_path) != 0) {
        ESP_LOGE(TAG_STORAGE, "failed to rotate incompatible CSV %s: errno=%d", path, errno);
        return false;
    }

    ESP_LOGW(TAG_STORAGE, "rotated incompatible CSV header: %s -> %s", path, backup_path);
    return true;
}

static FILE *storage_usb_log_open(FILE **slot, const char *path, const char *header)
{
    if (slot == NULL || path == NULL || header == NULL) {
        return NULL;
    }

    if (*slot != NULL) {
        return *slot;
    }

    if (!storage_usb_prepare_log_file(path, header)) {
        return NULL;
    }

    struct stat st = {};
    bool new_file = (stat(path, &st) != 0) || (st.st_size == 0);

    FILE *file = fopen(path, "a");
    if (file == NULL) {
        ESP_LOGE(TAG_STORAGE, "failed to open %s: errno=%d", path, errno);
        return NULL;
    }

    if (new_file) {
        fprintf(file, "%s", header);
        if (!storage_usb_sync_file(file, path)) {
            fclose(file);
            return NULL;
        }
    }

    *slot = file;
    ESP_LOGI(TAG_STORAGE, "USB log file ready: %s", path);
    return file;
}

static bool storage_usb_append_marker_to_full_log(const char *value);
static bool storage_usb_write_event_record(const storage_event_record_t *event);

static bool storage_usb_open_log_pair(void)
{
    FILE *full = storage_usb_log_open(&s_usb_full_log_file,
                                      STORAGE_USB_FULL_LOG_PATH,
                                      STORAGE_USB_FULL_HEADER);
    if (full == NULL) {
        ESP_LOGE(TAG_STORAGE, "failed to prepare full USB CSV");
        return false;
    }

    s_usb_valid_log_path = STORAGE_USB_VALID_LOG_PATH_PRIMARY;
    s_usb_valid_log_using_fallback = false;
    FILE *valid = storage_usb_log_open(&s_usb_valid_log_file,
                                       s_usb_valid_log_path,
                                       STORAGE_USB_VALID_HEADER);

    if (valid == NULL) {
        ESP_LOGW(TAG_STORAGE, "primary valid CSV failed, trying fallback: %s",
                 STORAGE_USB_VALID_LOG_PATH_FALLBACK);
        s_usb_valid_log_path = STORAGE_USB_VALID_LOG_PATH_FALLBACK;
        s_usb_valid_log_using_fallback = true;
        valid = storage_usb_log_open(&s_usb_valid_log_file,
                                     s_usb_valid_log_path,
                                     STORAGE_USB_VALID_HEADER);
        if (valid != NULL) {
            storage_usb_append_marker_to_full_log("VALID_LOG_FALLBACK");
        }
    }

    if (full == NULL || valid == NULL) {
        storage_usb_append_marker_to_full_log("VALID_LOG_FAILED");
        storage_usb_sync_logs(true);
        ESP_LOGE(TAG_STORAGE, "failed to prepare USB CSV pair: full=%p valid=%p path=%s",
                 (void *)full, (void *)valid, s_usb_valid_log_path);
        return false;
    }

    FILE *event = storage_usb_log_open(&s_usb_event_log_file,
                                       STORAGE_USB_EVENT_LOG_PATH,
                                       STORAGE_USB_EVENT_HEADER);
    if (event == NULL) {
        storage_usb_append_marker_to_full_log("EVENT_LOG_FAILED");
        storage_usb_sync_logs(true);
        ESP_LOGE(TAG_STORAGE, "failed to prepare event USB CSV");
        return false;
    }

    return storage_usb_sync_logs(true);
}

static bool storage_usb_write_event_record(const storage_event_record_t *event)
{
    if (!s_usb_disk_ready || event == NULL) {
        return false;
    }

    FILE *file = storage_usb_log_open(&s_usb_event_log_file,
                                      STORAGE_USB_EVENT_LOG_PATH,
                                      STORAGE_USB_EVENT_HEADER);
    if (file == NULL) {
        return false;
    }

    timestamp_info_t ts = {};
    time_utils_get_timestamp(&ts);
    fprintf(file, "%lu,", (unsigned long)esp_log_timestamp());
    storage_usb_write_csv_field(file, ts.text);
    fputc(',', file);
    storage_usb_write_csv_field(file, ts.time_source);
    fprintf(file, ",%u,%08lX,", ts.time_valid ? 1U : 0U, (unsigned long)ts.boot_id);
    storage_usb_write_csv_field(file, event->event);
    fputc(',', file);
    storage_usb_write_csv_field(file, event->detail);
    fprintf(file, "\r\n");
    s_usb_rows_since_sync++;
    return storage_usb_sync_logs(false);
}

static bool storage_usb_write_full_record(const lora_data_t *data)
{
    if (!s_usb_disk_ready || data == NULL) {
        return false;
    }

    FILE *file = storage_usb_log_open(&s_usb_full_log_file,
                                      STORAGE_USB_FULL_LOG_PATH,
                                      STORAGE_USB_FULL_HEADER);
    if (file == NULL) {
        return false;
    }

    fprintf(file, "%lu,%lu,",
            (unsigned long)esp_log_timestamp(), (unsigned long)data->tick_ms);
    storage_usb_write_csv_field(file, data->rx_time);
    fputc(',', file);
    storage_usb_write_csv_field(file, data->time_source);
    fprintf(file, ",%u,%08lX,", data->time_valid ? 1U : 0U, (unsigned long)data->boot_id);
    storage_usb_write_csv_field(file, data->status);
    fprintf(file,
            ",%u,%u,%u,%d,%d.%d,%d.%d,%d,%lu,",
            data->valid_packet ? 1U : 0U,
            data->binary_packet ? 1U : 0U,
            (unsigned)data->raw_len,
            (int)data->read_state,
            (int)(data->rssi_tenths / 10),
            abs((int)(data->rssi_tenths % 10)),
            (int)(data->snr_tenths / 10),
            abs((int)(data->snr_tenths % 10)),
            (int)data->freq_error_hz,
            (unsigned long)data->irq_count);
    storage_usb_write_csv_field(file, data->data);
    fputc(',', file);
    storage_usb_write_csv_field(file, data->raw_hex);
    fprintf(file, "\r\n");

    return true;
}

static bool storage_usb_write_valid_record(const lora_data_t *data)
{
    if (!s_usb_disk_ready || data == NULL || !data->valid_packet) {
        return false;
    }

    FILE *file = storage_usb_log_open(&s_usb_valid_log_file,
                                      s_usb_valid_log_path,
                                      STORAGE_USB_VALID_HEADER);
    if (file == NULL) {
        return false;
    }

    fprintf(file, "%lu,%lu,",
            (unsigned long)esp_log_timestamp(), (unsigned long)data->tick_ms);
    storage_usb_write_csv_field(file, data->rx_time);
    fputc(',', file);
    storage_usb_write_csv_field(file, data->time_source);
    fprintf(file, ",%u,%08lX,DATA,", data->time_valid ? 1U : 0U, (unsigned long)data->boot_id);
    storage_usb_write_csv_field(file, data->data);
    fprintf(file,
            ",%d.%d,%d.%d,%d,%lu,%u,",
            (int)(data->rssi_tenths / 10),
            abs((int)(data->rssi_tenths % 10)),
            (int)(data->snr_tenths / 10),
            abs((int)(data->snr_tenths % 10)),
            (int)data->freq_error_hz,
            (unsigned long)data->irq_count,
            (unsigned)data->raw_len);
    storage_usb_write_csv_field(file, data->raw_hex);
    fprintf(file, "\r\n");

    return true;
}

static bool storage_usb_append_marker_to_valid_log(const char *value)
{
    if (!s_usb_disk_ready || value == NULL) {
        return false;
    }

    FILE *file = storage_usb_log_open(&s_usb_valid_log_file,
                                      s_usb_valid_log_path,
                                      STORAGE_USB_VALID_HEADER);
    if (file == NULL) {
        return false;
    }

    timestamp_info_t ts = {};
    time_utils_get_timestamp(&ts);
    fprintf(file, "%lu,%lu,",
            (unsigned long)esp_log_timestamp(), (unsigned long)esp_log_timestamp());
    storage_usb_write_csv_field(file, ts.text);
    fputc(',', file);
    storage_usb_write_csv_field(file, ts.time_source);
    fprintf(file, ",%u,%08lX,", ts.time_valid ? 1U : 0U, (unsigned long)ts.boot_id);
    storage_usb_write_csv_field(file, value);
    fputc(',', file);
    storage_usb_write_csv_field(file, "");
    fprintf(file, ",0.0,0.0,0,0,0,");
    storage_usb_write_csv_field(file, "");
    fprintf(file, "\r\n");

    return true;
}

static bool storage_usb_append_marker_to_full_log(const char *value)
{
    if (!s_usb_disk_ready || value == NULL) {
        return false;
    }

    FILE *file = storage_usb_log_open(&s_usb_full_log_file,
                                      STORAGE_USB_FULL_LOG_PATH,
                                      STORAGE_USB_FULL_HEADER);
    if (file == NULL) {
        return false;
    }

    timestamp_info_t ts = {};
    time_utils_get_timestamp(&ts);
    fprintf(file, "%lu,%lu,", (unsigned long)esp_log_timestamp(), (unsigned long)esp_log_timestamp());
    storage_usb_write_csv_field(file, ts.text);
    fputc(',', file);
    storage_usb_write_csv_field(file, ts.time_source);
    fprintf(file, ",%u,%08lX,", ts.time_valid ? 1U : 0U, (unsigned long)ts.boot_id);
    storage_usb_write_csv_field(file, value);
    fprintf(file, ",0,0,0,0,0.0,0.0,0,0,");
    storage_usb_write_csv_field(file, "");
    fputc(',', file);
    storage_usb_write_csv_field(file, "");
    fprintf(file, "\r\n");

    return true;
}

static void storage_usb_log_marker(const char *event)
{
    bool ok = storage_usb_append_marker_to_full_log(event);
    ok = storage_usb_append_marker_to_valid_log(event) && ok;
    storage_event_record_t event_record = {};
    snprintf(event_record.event, sizeof(event_record.event), "%s", event != NULL ? event : "USB_EVENT");
    ok = storage_usb_write_event_record(&event_record) && ok;
    ok = storage_usb_sync_logs(true) && ok;
    if (!ok) {
        s_usb_write_fail_count++;
        storage_usb_cleanup_device("marker-write-failed", false);
    }
}

static bool storage_usb_append_loss_marker_to_valid_log(void)
{
    if (!s_usb_disk_ready) {
        return false;
    }

    FILE *file = storage_usb_log_open(&s_usb_valid_log_file,
                                      s_usb_valid_log_path,
                                      STORAGE_USB_VALID_HEADER);
    if (file == NULL) {
        return false;
    }

    fprintf(file, "%lu,%lu,",
            (unsigned long)esp_log_timestamp(), (unsigned long)esp_log_timestamp());
    storage_usb_write_csv_field(file, s_usb_loss_marker_ts.text);
    fputc(',', file);
    storage_usb_write_csv_field(file, s_usb_loss_marker_ts.time_source);
    fprintf(file, ",%u,%08lX,",
            s_usb_loss_marker_ts.time_valid ? 1U : 0U,
            (unsigned long)s_usb_loss_marker_ts.boot_id);
    storage_usb_write_csv_field(file, "USB_LOST");
    fputc(',', file);
    storage_usb_write_csv_field(file, "");
    fprintf(file, ",0.0,0.0,0,0,0,");
    storage_usb_write_csv_field(file, "");
    fprintf(file, "\r\n");
    return true;
}

static bool storage_usb_append_loss_marker_to_full_log(void)
{
    if (!s_usb_disk_ready) {
        return false;
    }

    FILE *file = storage_usb_log_open(&s_usb_full_log_file,
                                      STORAGE_USB_FULL_LOG_PATH,
                                      STORAGE_USB_FULL_HEADER);
    if (file == NULL) {
        return false;
    }

    fprintf(file, "%lu,%lu,", (unsigned long)esp_log_timestamp(), (unsigned long)esp_log_timestamp());
    storage_usb_write_csv_field(file, s_usb_loss_marker_ts.text);
    fputc(',', file);
    storage_usb_write_csv_field(file, s_usb_loss_marker_ts.time_source);
    fprintf(file, ",%u,%08lX,",
            s_usb_loss_marker_ts.time_valid ? 1U : 0U,
            (unsigned long)s_usb_loss_marker_ts.boot_id);
    storage_usb_write_csv_field(file, "USB_LOST");
    fprintf(file, ",0,0,0,0,0.0,0.0,0,0,");
    storage_usb_write_csv_field(file, "");
    fputc(',', file);
    storage_usb_write_csv_field(file, "");
    fprintf(file, "\r\n");
    return true;
}

static void storage_usb_flush_pending_loss_marker(void)
{
    if (!s_usb_loss_marker_pending) {
        return;
    }

    bool ok = storage_usb_append_loss_marker_to_full_log();
    ok = storage_usb_append_loss_marker_to_valid_log() && ok;
    storage_event_record_t event_record = {};
    snprintf(event_record.event, sizeof(event_record.event), "USB_LOST");
    ok = storage_usb_write_event_record(&event_record) && ok;
    ok = storage_usb_sync_logs(true) && ok;
    if (ok) {
        s_usb_loss_marker_pending = false;
        storage_usb_log_marker("USB_RECONNECTED");
    } else {
        s_usb_write_fail_count++;
        storage_usb_cleanup_device("pending-loss-marker-failed", false);
    }
}

static void storage_usb_flush_offline_buffer(void)
{
    if (!s_usb_disk_ready || s_offline_buffer_count == 0) {
        return;
    }

    uint16_t pending = s_offline_buffer_count;
    ESP_LOGI(TAG_STORAGE, "flushing offline LoRa buffer: %u records", (unsigned)pending);

    storage_event_record_t event_record = {};
    snprintf(event_record.event, sizeof(event_record.event), "OFFLINE_FLUSH_BEGIN");
    snprintf(event_record.detail, sizeof(event_record.detail), "records=%u overwritten=%lu",
             (unsigned)pending, (unsigned long)s_offline_buffer_overwrite_count);
    if (!storage_usb_write_event_record(&event_record)) {
        s_usb_write_fail_count++;
        storage_usb_cleanup_device("offline-flush-begin-failed", false);
        return;
    }

    lora_data_t buffered;
    uint16_t flushed = 0;
    while (s_usb_disk_ready && storage_offline_buffer_pop(&buffered)) {
        bool ok = storage_usb_write_full_record(&buffered);
        if (ok && buffered.valid_packet) {
            ok = storage_usb_write_valid_record(&buffered);
        }
        if (!ok) {
            storage_offline_buffer_push(&buffered);
            s_usb_write_fail_count++;
            storage_usb_cleanup_device("offline-buffer-flush-failed");
            return;
        }
        flushed++;
        s_usb_rows_since_sync++;
        if ((flushed % 8) == 0) {
            if (!storage_usb_sync_logs(false)) {
                s_usb_write_fail_count++;
                storage_usb_cleanup_device("offline-buffer-sync-failed");
                return;
            }
            vTaskDelay(1);
        }
    }

    storage_event_record_t done_record = {};
    snprintf(done_record.event, sizeof(done_record.event), "OFFLINE_FLUSH_DONE");
    snprintf(done_record.detail, sizeof(done_record.detail), "records=%u remaining=%u",
             (unsigned)flushed, (unsigned)s_offline_buffer_count);
    bool ok = storage_usb_write_event_record(&done_record);
    ok = storage_usb_sync_logs(true) && ok;
    if (!ok) {
        s_usb_write_fail_count++;
        storage_usb_cleanup_device("offline-flush-done-failed", false);
    }
}

static bool storage_usb_disk_write(const lora_data_t *data)
{
    bool ok = storage_usb_write_full_record(data);
    if (ok && data != NULL && data->valid_packet) {
        ok = storage_usb_write_valid_record(data);
    }
    if (ok) {
        s_usb_rows_since_sync++;
        ok = storage_usb_sync_logs(false);
    }

    if (!ok) {
        s_usb_write_fail_count++;
        storage_usb_cleanup_device("write-sync-failed");
        storage_drop_mirror();
    }

    if (!s_usb_disk_ready && s_storage_mode == STORAGE_MODE_USB_DISK) {
        s_storage_mode = STORAGE_MODE_USB_DISK_WAIT;
        ESP_LOGW(TAG_STORAGE, "storage mode: %s", storage_mode_name(s_storage_mode));
    }
    return ok;
}

static void storage_usb_mount_device(uint8_t address)
{
    if (s_usb_disk_ready || s_usb_msc_device != NULL) {
        ESP_LOGW(TAG_STORAGE, "USB disk connect while old handle exists; cleaning stale handle address=%u", address);
        storage_usb_cleanup_device("stale-handle-before-new-mount");
        TickType_t elapsed = xTaskGetTickCount() - s_usb_last_cleanup_tick;
        if (elapsed < pdMS_TO_TICKS(STORAGE_USB_RECONNECT_SETTLE_MS)) {
            vTaskDelay(pdMS_TO_TICKS(STORAGE_USB_RECONNECT_SETTLE_MS) - elapsed);
        }
    }

    esp_err_t err = msc_host_install_device(address, &s_usb_msc_device);
    if (err != ESP_OK) {
        ESP_LOGE(TAG_STORAGE, "msc_host_install_device failed: %s", esp_err_to_name(err));
        s_usb_msc_device = NULL;
        return;
    }

    const esp_vfs_fat_mount_config_t mount_config = {
        .format_if_mount_failed = false,
        .max_files = STORAGE_USB_MAX_OPEN_FILES,
        .allocation_unit_size = 4096,
        .disk_status_check_enable = false,
        .use_one_fat = false,
    };

    err = msc_host_vfs_register(s_usb_msc_device, STORAGE_USB_MOUNT_PATH, &mount_config, &s_usb_msc_vfs);
    if (err != ESP_OK) {
        ESP_LOGE(TAG_STORAGE, "msc_host_vfs_register failed: %s", esp_err_to_name(err));
        msc_host_uninstall_device(s_usb_msc_device);
        s_usb_msc_device = NULL;
        s_usb_msc_vfs = NULL;
        return;
    }

    s_usb_disk_address = address;
    s_usb_disk_ready = true;
    s_usb_rows_since_sync = 0;
    s_usb_last_sync_tick = xTaskGetTickCount();
    s_usb_mount_count++;
    ESP_LOGI(TAG_STORAGE, "USB disk mounted at %s; full=%s valid=%s event=%s mount_count=%lu",
             STORAGE_USB_MOUNT_PATH,
             STORAGE_USB_FULL_LOG_PATH,
             STORAGE_USB_VALID_LOG_PATH_PRIMARY,
             STORAGE_USB_EVENT_LOG_PATH,
             (unsigned long)s_usb_mount_count);

    if (!storage_usb_open_log_pair()) {
        s_usb_write_fail_count++;
        storage_usb_cleanup_device("prepare-csv-pair-failed", false);
        return;
    }

    if (s_usb_valid_log_using_fallback) {
        ESP_LOGW(TAG_STORAGE, "USB valid CSV fallback active: %s", s_usb_valid_log_path);
    } else {
        ESP_LOGI(TAG_STORAGE, "USB valid CSV ready: %s", s_usb_valid_log_path);
    }

    storage_usb_log_marker("USB_MOUNTED");
    storage_usb_flush_pending_loss_marker();
    storage_usb_flush_offline_buffer();
}

static void storage_usb_unmount_device(msc_host_device_handle_t handle)
{
    if (s_usb_msc_device == NULL || handle != s_usb_msc_device) {
        ESP_LOGW(TAG_STORAGE, "USB disk disconnected with unknown handle; current handle already cleaned");
        return;
    }

    storage_usb_cleanup_device("device-disconnected");
}

static void storage_usb_process_events(void)
{
    if (s_usb_event_queue == NULL) {
        return;
    }

    storage_usb_event_t event;
    while (xQueueReceive(s_usb_event_queue, &event, 0) == pdTRUE) {
        switch (event.id) {
        case STORAGE_USB_EVENT_CONNECTED:
            ESP_LOGI(TAG_STORAGE, "USB MSC connected: address=%u", event.address);
            storage_usb_mount_device(event.address);
            break;
        case STORAGE_USB_EVENT_DISCONNECTED:
            storage_usb_unmount_device(event.device_handle);
            break;
        default:
            break;
        }
    }
}

static void storage_msc_event_cb(const msc_host_event_t *event, void *arg)
{
    if (s_usb_event_queue == NULL || event == NULL) {
        return;
    }

    storage_usb_event_t msg = {};
    if (event->event == msc_host_event_t::MSC_DEVICE_CONNECTED) {
        msg.id = STORAGE_USB_EVENT_CONNECTED;
        msg.address = event->device.address;
    } else if (event->event == msc_host_event_t::MSC_DEVICE_DISCONNECTED) {
        msg.id = STORAGE_USB_EVENT_DISCONNECTED;
        msg.device_handle = event->device.handle;
    } else {
        return;
    }

    xQueueSend(s_usb_event_queue, &msg, 0);
}

static void storage_usb_host_task(void *arg)
{
    usb_host_config_t host_config = {};
    host_config.intr_flags = ESP_INTR_FLAG_LOWMED;
    esp_err_t err = usb_host_install(&host_config);
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        ESP_LOGE(TAG_STORAGE, "usb_host_install failed: %s", esp_err_to_name(err));
        s_usb_host_task_started = false;
        vTaskDelete(NULL);
        return;
    }

    msc_host_driver_config_t msc_config = {};
    msc_config.create_backround_task = true;
    msc_config.task_priority = 3;
    msc_config.stack_size = 4096;
    msc_config.core_id = 0;
    msc_config.callback = storage_msc_event_cb;
    msc_config.callback_arg = NULL;
    err = msc_host_install(&msc_config);
    if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
        ESP_LOGE(TAG_STORAGE, "msc_host_install failed: %s", esp_err_to_name(err));
        s_usb_host_task_started = false;
        vTaskDelete(NULL);
        return;
    }

    s_usb_host_ready = true;
    ESP_LOGI(TAG_STORAGE, "USB Host MSC started; waiting for flash drive");

    while (true) {
        uint32_t event_flags = 0;
        err = usb_host_lib_handle_events(pdMS_TO_TICKS(1000), &event_flags);
        if (err != ESP_OK && err != ESP_ERR_TIMEOUT) {
            ESP_LOGW(TAG_STORAGE, "usb_host_lib_handle_events: %s", esp_err_to_name(err));
        }
        storage_usb_process_events();
    }
}

static bool storage_usb_host_ensure_started(bool verbose)
{
    if (s_usb_event_queue == NULL) {
        s_usb_event_queue = xQueueCreate(8, sizeof(storage_usb_event_t));
        if (s_usb_event_queue == NULL) {
            ESP_LOGE(TAG_STORAGE, "failed to create USB event queue");
            return false;
        }
    }

    if (!s_usb_host_task_started) {
        BaseType_t ok = xTaskCreatePinnedToCore(
            storage_usb_host_task,
            "usb_host",
            4096,
            NULL,
            2,
            &s_usb_host_task_handle,
            0
        );
        if (ok != pdPASS) {
            ESP_LOGE(TAG_STORAGE, "failed to create USB host task");
            return false;
        }
        s_usb_host_task_started = true;
        if (verbose) {
            ESP_LOGI(TAG_STORAGE, "USB host task created");
        }
    }

    return s_usb_host_ready;
}
#endif

static bool storage_usb_disk_try_start(bool verbose)
{
#if CONFIG_LORA_ENABLE_USB_MSC_STORAGE
    storage_usb_host_ensure_started(verbose);
    storage_usb_process_events();
    return s_usb_disk_ready;
#else
    if (verbose) {
        ESP_LOGW(TAG_STORAGE,
                 "USB disk mode requested, but CONFIG_LORA_ENABLE_USB_MSC_STORAGE is off; waiting and dropping mirrors");
    }
    return false;
#endif
}

static bool storage_usb_disk_ready(void)
{
#if CONFIG_LORA_ENABLE_USB_MSC_STORAGE
    storage_usb_process_events();
    return s_usb_disk_ready;
#else
    return false;
#endif
}

static storage_mode_t storage_detect_mode(void)
{
    TickType_t deadline = xTaskGetTickCount() + pdMS_TO_TICKS(STORAGE_DETECT_WINDOW_MS);

    while (xTaskGetTickCount() < deadline) {
        if (usb_serial_jtag_is_connected()) {
            if (storage_usb_serial_jtag_ensure_started()) {
                return STORAGE_MODE_PC_LOG;
            }
            break;
        }
        vTaskDelay(pdMS_TO_TICKS(100));
    }

    if (storage_usb_disk_try_start(true)) {
        return STORAGE_MODE_USB_DISK;
    }

    return STORAGE_MODE_USB_DISK_WAIT;
}

static void storage_task(void *arg)
{
    ESP_LOGI(TAG_STORAGE, "storage detect window: %d ms", STORAGE_DETECT_WINDOW_MS);
    s_storage_mode = storage_detect_mode();
    ESP_LOGI(TAG_STORAGE, "storage mode: %s", storage_mode_name(s_storage_mode));

    TickType_t last_usb_disk_retry = xTaskGetTickCount();
    TickType_t last_usb_disk_warn = xTaskGetTickCount();
    storage_record_t record;
    while (true) {
        TickType_t receive_timeout = portMAX_DELAY;

        if (s_storage_mode == STORAGE_MODE_USB_DISK_WAIT || s_storage_mode == STORAGE_MODE_USB_DISK) {
            TickType_t now = xTaskGetTickCount();
            bool disk_ready = storage_usb_disk_ready();
            if (s_storage_mode == STORAGE_MODE_USB_DISK && !disk_ready) {
                s_storage_mode = STORAGE_MODE_USB_DISK_WAIT;
                ESP_LOGW(TAG_STORAGE, "storage mode: %s", storage_mode_name(s_storage_mode));
            }

            if (s_storage_mode == STORAGE_MODE_USB_DISK_WAIT &&
                (now - last_usb_disk_retry) >= pdMS_TO_TICKS(STORAGE_USB_DISK_RETRY_MS)) {
                bool verbose = (now - last_usb_disk_warn) >= pdMS_TO_TICKS(STORAGE_USB_DISK_WARN_INTERVAL_MS);
                if (storage_usb_disk_try_start(verbose)) {
                    s_storage_mode = STORAGE_MODE_USB_DISK;
                    ESP_LOGI(TAG_STORAGE, "storage mode: %s", storage_mode_name(s_storage_mode));
                }
                last_usb_disk_retry = now;
                if (verbose) {
                    last_usb_disk_warn = now;
                }
            }
            receive_timeout = pdMS_TO_TICKS(500);
        }

        if (xQueueReceive(s_storage_queue, &record, receive_timeout) != pdTRUE) {
#if CONFIG_LORA_ENABLE_USB_MSC_STORAGE
            if (s_storage_mode == STORAGE_MODE_USB_DISK) {
                storage_usb_sync_logs(false);
            }
#endif
            continue;
        }

        if (record.type == STORAGE_RECORD_EVENT) {
            ESP_LOGI(TAG_STORAGE, "event: %s %s", record.payload.event.event, record.payload.event.detail);
#if CONFIG_LORA_ENABLE_USB_MSC_STORAGE
            if (s_storage_mode == STORAGE_MODE_USB_DISK) {
                if (!storage_usb_write_event_record(&record.payload.event)) {
                    s_usb_write_fail_count++;
                    storage_usb_cleanup_device("event-write-failed");
                }
            }
#endif
            continue;
        }

        switch (s_storage_mode) {
        case STORAGE_MODE_PC_LOG:
            storage_pc_log_write(&record.payload.lora);
            break;
        case STORAGE_MODE_USB_DISK:
#if CONFIG_LORA_ENABLE_USB_MSC_STORAGE
            if (!storage_usb_disk_write(&record.payload.lora)) {
                storage_offline_buffer_push(&record.payload.lora);
            }
#else
            storage_offline_buffer_push(&record.payload.lora);
            storage_drop_mirror();
#endif
            break;
        case STORAGE_MODE_USB_DISK_WAIT:
        case STORAGE_MODE_RAM_ONLY:
        default:
            storage_offline_buffer_push(&record.payload.lora);
            storage_drop_mirror();
            break;
        }
    }
}

esp_err_t storage_manager_start(void)
{
    if (s_storage_queue != NULL) {
        return ESP_OK;
    }

    if (s_offline_buffer_mutex == NULL) {
        s_offline_buffer_mutex = xSemaphoreCreateMutex();
        if (s_offline_buffer_mutex == NULL) {
            ESP_LOGE(TAG_STORAGE, "failed to create offline buffer mutex");
            return ESP_ERR_NO_MEM;
        }
    }

    s_storage_queue = xQueueCreate(STORAGE_QUEUE_DEPTH, sizeof(storage_record_t));
    if (s_storage_queue == NULL) {
        ESP_LOGE(TAG_STORAGE, "failed to create storage queue");
        return ESP_ERR_NO_MEM;
    }

    BaseType_t ok = xTaskCreatePinnedToCore(
        storage_task,
        "storage",
        4096,
        NULL,
        2,
        NULL,
        0
    );
    if (ok != pdPASS) {
        ESP_LOGE(TAG_STORAGE, "failed to create storage task");
        return ESP_ERR_NO_MEM;
    }

    ESP_LOGI(TAG_STORAGE, "storage manager started");
    return ESP_OK;
}

void storage_manager_submit_lora(const lora_data_t *data)
{
    if (s_storage_queue == NULL || data == NULL) {
        return;
    }

    storage_record_t record = {};
    record.type = STORAGE_RECORD_LORA;
    record.payload.lora = *data;

    if (xQueueSend(s_storage_queue, &record, 0) != pdTRUE) {
        s_storage_queue_drop_count++;
        if ((s_storage_queue_drop_count % 50) == 1) {
            ESP_LOGW(TAG_STORAGE, "storage queue full; dropped oldest count=%lu",
                     (unsigned long)s_storage_queue_drop_count);
        }

        storage_record_t dropped;
        xQueueReceive(s_storage_queue, &dropped, 0);
        if (dropped.type == STORAGE_RECORD_LORA) {
            storage_offline_buffer_push(&dropped.payload.lora);
        }
        if (xQueueSend(s_storage_queue, &record, 0) != pdTRUE) {
            ESP_LOGE(TAG_STORAGE, "storage queue requeue failed");
        }
    }
}

void storage_manager_submit_event(const char *event, const char *detail)
{
    if (s_storage_queue == NULL || event == NULL) {
        return;
    }

    storage_record_t record = {};
    record.type = STORAGE_RECORD_EVENT;
    snprintf(record.payload.event.event, sizeof(record.payload.event.event), "%s", event);
    if (detail != NULL) {
        snprintf(record.payload.event.detail, sizeof(record.payload.event.detail), "%s", detail);
    }

    if (xQueueSend(s_storage_queue, &record, 0) != pdTRUE) {
        s_storage_queue_drop_count++;
        ESP_LOGW(TAG_STORAGE, "storage queue full; dropped event=%s count=%lu",
                 record.payload.event.event, (unsigned long)s_storage_queue_drop_count);
    }
}
