#include <stdio.h>
#include <string.h>
#include <inttypes.h>
#include <sys/time.h>
#include <time.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"

#include "driver/uart.h"
#include "driver/gpio.h"

#include "esp_log.h"
#include "esp_system.h"
#include "nvs_flash.h"
#include "sdkconfig.h"
#include "esp_task_wdt.h"

#include "lora_driver.h"
#include "storage_manager.h"
#include "time_utils.h"

static const char *TAG_LORA = "LORA_RX";
static const char *TAG_4G = "ML307R_MQTT";
static const char *TAG_BOOT = "BOOT";
static const char *TAG_SELF = "SELF";
static const char *TAG_CMD = "CMD";

#define UART_NUM UART_NUM_1
#define TXD_PIN 12
#define RXD_PIN 13
#define UART_BAUD_RATE 115200
#define BUF_SIZE 1024
#define MQTT_DATA_BUFFER_SIZE 640
#define MQTT_ESCAPED_DATA_SIZE 512
#define UART_MUTEX_TIMEOUT_MS 1000
#define UART_READ_SLICE_MS 100
#define MQTT_PAYLOAD_ACK_TIMEOUT_MS 3000
#define MQTT_IDLE_DELAY_MS 100
#define MODEM_NETWORK_RETRY_MS 5000
#define MQTT_RECONNECT_DELAY_MIN_MS 5000
#define MQTT_RECONNECT_DELAY_MAX_MS 30000
#define MQTT_POST_CONNECT_SETTLE_MS 1000
#define MQTT_RECOVERY_DISCONNECT_FAILS 3
#define MQTT_RECOVERY_PDP_RESET_FAILS 6
#define MQTT_RECOVERY_MODEM_RESET_FAILS 12
#define HEARTBEAT_INTERVAL_MS 300000
#define MODEM_TIME_SYNC_RETRY_MS 60000
#define MODEM_TIME_REFRESH_MS 3600000
#define MODEM_PDP_RESET_WAIT_MS 5000
#define MODEM_SOFT_RESET_WAIT_MS 15000
#define MODEM_MIN_CSQ_RSSI 5

static const char *CMD_MQTT_CONN =
    "AT+MQTTCONN=0,\"REDACTED_MQTT_HOST\",1883,\"\",\"REDACTED_MQTT_USERNAME\",\"REDACTED_MQTT_PASSWORD\"\r\n";
static const char *CMD_MQTT_PUB =
    "AT+MQTTPUB=0,\"attributes\",0,0,0,%d\r\n";

#define MAX_DATA_QUEUE 200

static QueueHandle_t lora_data_queue = NULL;
static SemaphoreHandle_t uart_mutex = NULL;
static uint32_t s_mqtt_retry_drop_count = 0;
static uint32_t s_mqtt_payload_drop_count = 0;
static uint32_t s_modem_error_count = 0;
static bool s_time_synced = false;

static char s_cmd_rx_buf[BUF_SIZE];
static char s_cmd_clean_buf[BUF_SIZE];

static bool send_command(const char *cmd, uint32_t timeout_ms,
                         const char *expect_resp,
                         const char *expect_resp2 = NULL);
static bool send_command_capture_response(const char *cmd,
                                          uint32_t timeout_ms,
                                          const char *expect_resp,
                                          char *response,
                                          size_t response_len);

static void handle_reset_cmd(void)
{
    ESP_LOGW(TAG_CMD, "remote reset received; rebooting in 3 seconds");
    vTaskDelay(pdMS_TO_TICKS(3000));
    esp_restart();
}

static void uart_init(void)
{
    uart_config_t uart_config = {};
    uart_config.baud_rate = UART_BAUD_RATE;
    uart_config.data_bits = UART_DATA_8_BITS;
    uart_config.parity = UART_PARITY_DISABLE;
    uart_config.stop_bits = UART_STOP_BITS_1;
    uart_config.flow_ctrl = UART_HW_FLOWCTRL_DISABLE;
    uart_config.source_clk = UART_SCLK_APB;

    uart_driver_delete(UART_NUM);
    uart_driver_install(UART_NUM, BUF_SIZE * 2, BUF_SIZE * 2, 0, NULL, 0);
    uart_param_config(UART_NUM, &uart_config);
    uart_set_pin(UART_NUM, TXD_PIN, RXD_PIN, UART_PIN_NO_CHANGE, UART_PIN_NO_CHANGE);
    uart_flush(UART_NUM);
}

static bool is_sensitive_command(const char *cmd)
{
    return cmd != NULL && strstr(cmd, "AT+MQTTCONN=") != NULL;
}

static bool response_matches(const char *buf, const char *expect_resp, const char *expect_resp2)
{
    return (expect_resp != NULL && strstr(buf, expect_resp) != NULL) ||
           (expect_resp2 != NULL && strstr(buf, expect_resp2) != NULL);
}

static bool response_expects_prompt(const char *expect_resp, const char *expect_resp2)
{
    return (expect_resp != NULL && strcmp(expect_resp, ">") == 0) ||
           (expect_resp2 != NULL && strcmp(expect_resp2, ">") == 0);
}

static void append_filtered_response(char *dst, size_t dst_size, size_t *dst_len,
                                     const char *src, int src_len)
{
    if (dst == NULL || dst_size == 0 || dst_len == NULL || src == NULL || src_len <= 0) {
        return;
    }

    for (int i = 0; i < src_len; ++i) {
        unsigned char c = (unsigned char)src[i];
        if (c != '\r' && c != '\n' && (c < 0x20 || c > 0x7E)) {
            continue;
        }

        if (*dst_len >= dst_size - 1) {
            size_t keep = dst_size / 2;
            memmove(dst, dst + (*dst_len - keep), keep);
            *dst_len = keep;
        }
        dst[(*dst_len)++] = (char)c;
    }
    dst[*dst_len] = 0;
}

static bool uart_read_response_locked(uint32_t timeout_ms,
                                      const char *expect_resp,
                                      const char *expect_resp2,
                                      bool *saw_reset)
{
    memset(s_cmd_rx_buf, 0, sizeof(s_cmd_rx_buf));
    memset(s_cmd_clean_buf, 0, sizeof(s_cmd_clean_buf));

    if (saw_reset != NULL) {
        *saw_reset = false;
    }

    bool found = false;
    bool got_any = false;
    bool saw_error = false;
    const bool expect_prompt = response_expects_prompt(expect_resp, expect_resp2);
    size_t clean_len = 0;

    TickType_t timeout_ticks = pdMS_TO_TICKS(timeout_ms);
    if (timeout_ticks == 0) {
        timeout_ticks = 1;
    }
    const TickType_t start = xTaskGetTickCount();

    while ((xTaskGetTickCount() - start) < timeout_ticks) {
        TickType_t elapsed = xTaskGetTickCount() - start;
        TickType_t remaining = timeout_ticks - elapsed;
        TickType_t wait_ticks = pdMS_TO_TICKS(UART_READ_SLICE_MS);
        if (wait_ticks == 0) {
            wait_ticks = 1;
        }
        if (remaining < wait_ticks) {
            wait_ticks = remaining;
        }
        if (wait_ticks == 0) {
            break;
        }

        int len = uart_read_bytes(UART_NUM,
                                  (uint8_t *)s_cmd_rx_buf,
                                  sizeof(s_cmd_rx_buf) - 1,
                                  wait_ticks);
        if (len <= 0) {
            continue;
        }

        got_any = true;
        s_cmd_rx_buf[len] = 0;
        append_filtered_response(s_cmd_clean_buf, sizeof(s_cmd_clean_buf),
                                 &clean_len, s_cmd_rx_buf, len);

        if (response_matches(s_cmd_clean_buf, expect_resp, expect_resp2)) {
            found = true;
            if (expect_prompt || strstr(s_cmd_clean_buf, "OK") != NULL) {
                break;
            }
        }

        if (strstr(s_cmd_clean_buf, "\"method\"") != NULL &&
            strstr(s_cmd_clean_buf, "\"reset\"") != NULL) {
            if (saw_reset != NULL) {
                *saw_reset = true;
            }
            break;
        }

        if (strstr(s_cmd_clean_buf, "ERROR") != NULL) {
            saw_error = true;
            break;
        }
    }

    if (got_any) {
        ESP_LOGI(TAG_4G, "recv: %s", s_cmd_clean_buf);
        if (saw_error && !found) {
            s_modem_error_count++;
            if ((s_modem_error_count % 10) == 1) {
                ESP_LOGW(TAG_4G, "modem returned ERROR count=%lu",
                         (unsigned long)s_modem_error_count);
            }
        }
    } else {
        ESP_LOGE(TAG_4G, "command timeout");
    }

    return found;
}

static bool uart_write_payload_wait_ok(const char *payload, int payload_len, const char *label)
{
    if (uart_mutex == NULL || payload == NULL || payload_len <= 0) {
        return false;
    }

    if (xSemaphoreTake(uart_mutex, pdMS_TO_TICKS(UART_MUTEX_TIMEOUT_MS)) != pdTRUE) {
        ESP_LOGW(TAG_4G, "%s wait UART mutex timeout", label);
        return false;
    }

    uart_write_bytes(UART_NUM, payload, payload_len);
    bool saw_reset = false;
    bool ok = uart_read_response_locked(MQTT_PAYLOAD_ACK_TIMEOUT_MS, "OK", NULL, &saw_reset);
    xSemaphoreGive(uart_mutex);

    if (saw_reset) {
        ESP_LOGW(TAG_CMD, "reset command detected during payload write");
        handle_reset_cmd();
        return ok;
    }

    if (!ok) {
        ESP_LOGW(TAG_4G, "%s did not receive OK", label);
    }
    return ok;
}

static bool json_escape_string(char *out, size_t out_len, const char *in)
{
    if (out == NULL || out_len == 0 || in == NULL) {
        return false;
    }

    size_t j = 0;
    for (const char *p = in; *p != '\0'; ++p) {
        char c = *p;
        const char *escape = NULL;
        if (c == '"' || c == '\\') {
            if (j + 2 >= out_len) {
                return false;
            }
            out[j++] = '\\';
            out[j++] = c;
            continue;
        } else if (c == '\r') {
            escape = "\\r";
        } else if (c == '\n') {
            escape = "\\n";
        } else if (c == '\t') {
            escape = "\\t";
        }

        if (escape != NULL) {
            if (j + 2 >= out_len) {
                return false;
            }
            out[j++] = escape[0];
            out[j++] = escape[1];
            continue;
        }

        if ((unsigned char)c < 0x20) {
            c = '.';
        }

        if (j + 1 >= out_len) {
            return false;
        }
        out[j++] = c;
    }
    out[j] = 0;
    return true;
}

static void mqtt_requeue_or_drop_oldest(const lora_data_t *data)
{
    if (lora_data_queue == NULL || data == NULL) {
        return;
    }

    if (xQueueSendToFront(lora_data_queue, data, 0) == pdTRUE) {
        return;
    }

    lora_data_t dropped;
    bool dropped_oldest = (xQueueReceive(lora_data_queue, &dropped, 0) == pdTRUE);
    if (dropped_oldest && xQueueSendToFront(lora_data_queue, data, 0) == pdTRUE) {
        s_mqtt_retry_drop_count++;
        ESP_LOGW(TAG_4G, "MQTT retry queue full; dropped oldest count=%lu",
                 (unsigned long)s_mqtt_retry_drop_count);
        return;
    }

    s_mqtt_retry_drop_count++;
    ESP_LOGE(TAG_4G, "MQTT retry requeue failed count=%lu",
             (unsigned long)s_mqtt_retry_drop_count);
}

static int64_t days_from_civil(int year, unsigned month, unsigned day)
{
    year -= month <= 2;
    const int era = (year >= 0 ? year : year - 399) / 400;
    const unsigned yoe = (unsigned)(year - era * 400);
    const unsigned doy = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1;
    const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    return era * 146097LL + (int64_t)doe - 719468LL;
}

static bool parse_cclk_epoch_utc(const char *response, time_t *out_epoch)
{
    if (response == NULL || out_epoch == NULL) {
        return false;
    }

    const char *p = strstr(response, "+CCLK:");
    if (p == NULL) {
        return false;
    }

    p = strchr(p, '"');
    if (p == NULL) {
        return false;
    }
    p++;

    int yy = 0;
    int month = 0;
    int day = 0;
    int hour = 0;
    int minute = 0;
    int second = 0;
    char tz_sign = '+';
    int tz_quarters = 0;
    int parsed = sscanf(p, "%d/%d/%d,%d:%d:%d%c%d",
                        &yy, &month, &day, &hour, &minute, &second,
                        &tz_sign, &tz_quarters);
    if (parsed < 6) {
        return false;
    }

    if (yy < 0 || yy > 99 || month < 1 || month > 12 || day < 1 || day > 31 ||
        hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 60) {
        return false;
    }

    int year = 2000 + yy;
    int tz_offset_seconds = 0;
    if (parsed >= 8 && (tz_sign == '+' || tz_sign == '-')) {
        tz_offset_seconds = tz_quarters * 15 * 60;
        if (tz_sign == '-') {
            tz_offset_seconds = -tz_offset_seconds;
        }
    }

    int64_t days = days_from_civil(year, (unsigned)month, (unsigned)day);
    int64_t local_epoch = days * 86400LL + hour * 3600LL + minute * 60LL + second;
    int64_t utc_epoch = local_epoch - tz_offset_seconds;
    if (utc_epoch < 1700000000LL) {
        return false;
    }

    *out_epoch = (time_t)utc_epoch;
    return true;
}

static bool parse_csq_rssi(const char *response, int *out_rssi)
{
    if (response == NULL || out_rssi == NULL) {
        return false;
    }

    const char *p = strstr(response, "+CSQ:");
    if (p == NULL) {
        return false;
    }

    int rssi = 99;
    int ber = 99;
    if (sscanf(p, "+CSQ: %d,%d", &rssi, &ber) != 2) {
        return false;
    }

    *out_rssi = rssi;
    return rssi != 99 && rssi >= MODEM_MIN_CSQ_RSSI;
}

static bool modem_has_usable_signal(void)
{
    char response[BUF_SIZE] = {};
    if (!send_command_capture_response("AT+CSQ\r\n", 1500, "OK",
                                       response, sizeof(response))) {
        ESP_LOGW(TAG_4G, "read CSQ failed");
        return false;
    }

    int rssi = 99;
    bool ok = parse_csq_rssi(response, &rssi);
    if (!ok) {
        ESP_LOGW(TAG_4G, "signal not usable: CSQ=%d", rssi);
        return false;
    }

    ESP_LOGI(TAG_4G, "signal usable: CSQ=%d", rssi);
    return true;
}

static bool modem_is_network_registered(void)
{
    if (send_command("AT+CEREG?\r\n", 1500, "+CEREG: 0,1", "+CEREG: 0,5")) {
        return true;
    }

    ESP_LOGW(TAG_4G, "modem not registered; retry in %u ms", (unsigned)MODEM_NETWORK_RETRY_MS);
    return false;
}

static bool modem_is_packet_attached(void)
{
    if (send_command("AT+CGATT?\r\n", 1500, "+CGATT: 1")) {
        return true;
    }

    ESP_LOGW(TAG_4G, "packet service not attached; retry in %u ms",
             (unsigned)MODEM_NETWORK_RETRY_MS);
    return false;
}

static bool modem_preflight_ready(void)
{
    if (!modem_has_usable_signal()) {
        return false;
    }

    if (!modem_is_network_registered()) {
        return false;
    }

    if (!modem_is_packet_attached()) {
        return false;
    }

    ESP_LOGI(TAG_4G, "modem preflight ready");
    return true;
}

static uint32_t mqtt_reconnect_delay_ms(uint32_t fail_count)
{
    if (fail_count == 0) {
        return MQTT_RECONNECT_DELAY_MIN_MS;
    }

    uint32_t multiplier = fail_count;
    if (multiplier > 6) {
        multiplier = 6;
    }

    uint32_t delay_ms = MQTT_RECONNECT_DELAY_MIN_MS * multiplier;
    if (delay_ms > MQTT_RECONNECT_DELAY_MAX_MS) {
        delay_ms = MQTT_RECONNECT_DELAY_MAX_MS;
    }
    return delay_ms;
}

static void mqtt_delay_with_wdt(uint32_t delay_ms)
{
    while (delay_ms > 0) {
        uint32_t slice_ms = delay_ms > 1000 ? 1000 : delay_ms;
        vTaskDelay(pdMS_TO_TICKS(slice_ms));
        esp_task_wdt_reset();
        delay_ms -= slice_ms;
    }
}

static void modem_recover_after_mqtt_connect_fail(uint32_t fail_count)
{
    char detail[64];
    snprintf(detail, sizeof(detail), "fail_count=%lu", (unsigned long)fail_count);

    if ((fail_count % MQTT_RECOVERY_MODEM_RESET_FAILS) == 0) {
        ESP_LOGW(TAG_4G, "MQTT connect stuck; soft-resetting modem");
        storage_manager_submit_event("MODEM_SOFT_RESET", detail);
        send_command("AT+CFUN=1,1\r\n", 2000, "OK");
        mqtt_delay_with_wdt(MODEM_SOFT_RESET_WAIT_MS);
        uart_flush(UART_NUM);
        s_time_synced = false;
        return;
    }

    if ((fail_count % MQTT_RECOVERY_PDP_RESET_FAILS) == 0) {
        ESP_LOGW(TAG_4G, "MQTT connect stuck; resetting PDP context");
        storage_manager_submit_event("MODEM_PDP_RESET", detail);
        send_command("AT+MQTTDISC=0\r\n", 1200, "OK", "ERROR");
        send_command("AT+CGACT=0,1\r\n", 3000, "OK", "ERROR");
        mqtt_delay_with_wdt(1000);
        send_command("AT+CGACT=1,1\r\n", 5000, "OK", "ERROR");
        mqtt_delay_with_wdt(MODEM_PDP_RESET_WAIT_MS);
        return;
    }

    if ((fail_count % MQTT_RECOVERY_DISCONNECT_FAILS) == 0) {
        ESP_LOGW(TAG_4G, "MQTT connect failed repeatedly; clearing MQTT session");
        storage_manager_submit_event("MQTT_SESSION_CLEAR", detail);
        send_command("AT+MQTTDISC=0\r\n", 1200, "OK", "ERROR");
        mqtt_delay_with_wdt(1000);
    }
}

static bool modem_sync_time(void)
{
    char response[BUF_SIZE] = {};
    if (!send_command_capture_response("AT+CCLK?\r\n", 1800, "OK",
                                       response, sizeof(response))) {
        ESP_LOGW(TAG_4G, "read modem time failed");
        storage_manager_submit_event("TIME_SYNC_FAILED", "read modem time failed");
        return false;
    }

    time_t epoch = 0;
    if (!parse_cclk_epoch_utc(response, &epoch)) {
        ESP_LOGW(TAG_4G, "invalid modem time: %s", response);
        storage_manager_submit_event("TIME_SYNC_FAILED", "invalid modem time");
        return false;
    }

    struct timeval tv = {};
    tv.tv_sec = epoch;
    tv.tv_usec = 0;
    if (settimeofday(&tv, NULL) != 0) {
        ESP_LOGW(TAG_4G, "set system time failed");
        storage_manager_submit_event("TIME_SYNC_FAILED", "settimeofday failed");
        return false;
    }

    char time_buf[32] = {};
    struct tm tm_utc = {};
    gmtime_r(&epoch, &tm_utc);
    strftime(time_buf, sizeof(time_buf), "%Y-%m-%dT%H:%M:%SZ", &tm_utc);
    s_time_synced = true;
    ESP_LOGI(TAG_4G, "system time synced: %s", time_buf);
    storage_manager_submit_event("TIME_SYNC_OK", time_buf);
    return true;
}

static bool send_command(const char *cmd, uint32_t timeout_ms,
                         const char *expect_resp,
                         const char *expect_resp2)
{
    if (uart_mutex == NULL) {
        ESP_LOGE(TAG_4G, "UART mutex not created");
        return false;
    }

    if (xSemaphoreTake(uart_mutex, pdMS_TO_TICKS(UART_MUTEX_TIMEOUT_MS)) != pdTRUE) {
        ESP_LOGW(TAG_4G, "wait UART mutex timeout");
        return false;
    }

    if (cmd != NULL && cmd[0] != 0) {
        if (is_sensitive_command(cmd)) {
            ESP_LOGI(TAG_4G, "send: AT+MQTTCONN=<redacted>");
        } else {
            ESP_LOGI(TAG_4G, "send: %s", cmd);
        }
        uart_write_bytes(UART_NUM, cmd, strlen(cmd));
    }

    bool saw_reset = false;
    bool found = uart_read_response_locked(timeout_ms, expect_resp, expect_resp2, &saw_reset);
    xSemaphoreGive(uart_mutex);

    if (saw_reset) {
        ESP_LOGW(TAG_CMD, "reset command detected in AT response");
        handle_reset_cmd();
    }

    return found;
}

static bool send_command_capture_response(const char *cmd,
                                          uint32_t timeout_ms,
                                          const char *expect_resp,
                                          char *response,
                                          size_t response_len)
{
    if (response != NULL && response_len > 0) {
        response[0] = 0;
    }

    if (uart_mutex == NULL) {
        ESP_LOGE(TAG_4G, "UART mutex not created");
        return false;
    }

    if (xSemaphoreTake(uart_mutex, pdMS_TO_TICKS(UART_MUTEX_TIMEOUT_MS)) != pdTRUE) {
        ESP_LOGW(TAG_4G, "wait UART mutex timeout");
        return false;
    }

    if (cmd != NULL && cmd[0] != 0) {
        ESP_LOGI(TAG_4G, "send: %s", cmd);
        uart_write_bytes(UART_NUM, cmd, strlen(cmd));
    }

    bool saw_reset = false;
    bool found = uart_read_response_locked(timeout_ms, expect_resp, NULL, &saw_reset);
    if (response != NULL && response_len > 0) {
        snprintf(response, response_len, "%s", s_cmd_clean_buf);
    }
    xSemaphoreGive(uart_mutex);

    if (saw_reset) {
        ESP_LOGW(TAG_CMD, "reset command detected in captured response");
        handle_reset_cmd();
    }

    return found;
}

static bool mqtt_publish_payload(const char *payload, int payload_len, const char *label)
{
    if (payload == NULL || payload_len <= 0) {
        return false;
    }

    char publish_cmd[64];
    snprintf(publish_cmd, sizeof(publish_cmd), CMD_MQTT_PUB, payload_len);
    if (!send_command(publish_cmd, 1000, ">")) {
        return false;
    }

    esp_task_wdt_reset();
    bool ok = uart_write_payload_wait_ok(payload, payload_len, label);
    esp_task_wdt_reset();
    return ok;
}

static void mqtt_task(void *pvParameters)
{
    bool mqtt_connected = false;
    lora_data_t current_data;
    char mqtt_data_buffer[MQTT_DATA_BUFFER_SIZE];
    TickType_t next_heartbeat_tick = xTaskGetTickCount() + pdMS_TO_TICKS(HEARTBEAT_INTERVAL_MS);
    TickType_t next_time_sync_tick = xTaskGetTickCount();
    uint32_t mqtt_fail_count = 0;

    esp_task_wdt_add(NULL);
    vTaskDelay(pdMS_TO_TICKS(1000));

    while (1) {
        if (!mqtt_connected) {
            if (!modem_preflight_ready()) {
                storage_manager_submit_event("MODEM_PREFLIGHT_WAIT", "");
                mqtt_delay_with_wdt(MODEM_NETWORK_RETRY_MS);
                continue;
            }

            ESP_LOGI(TAG_4G, "4G network ready");
            storage_manager_submit_event("MODEM_READY", "");
            vTaskDelay(pdMS_TO_TICKS(300));
            if (!s_time_synced ||
                (int32_t)(xTaskGetTickCount() - next_time_sync_tick) >= 0) {
                if (modem_sync_time()) {
                    next_time_sync_tick = xTaskGetTickCount() + pdMS_TO_TICKS(MODEM_TIME_REFRESH_MS);
                } else {
                    next_time_sync_tick = xTaskGetTickCount() + pdMS_TO_TICKS(MODEM_TIME_SYNC_RETRY_MS);
                }
            }
            esp_task_wdt_reset();

            if (!send_command(CMD_MQTT_CONN, 2000, "OK")) {
                mqtt_fail_count++;
                uint32_t retry_ms = mqtt_reconnect_delay_ms(mqtt_fail_count);
                char detail[64];
                snprintf(detail, sizeof(detail), "fail_count=%lu retry_ms=%u",
                         (unsigned long)mqtt_fail_count, (unsigned)retry_ms);
                storage_manager_submit_event("MQTT_CONNECT_FAILED", detail);
                ESP_LOGW(TAG_4G, "MQTT connect failed; retry in %u ms",
                         (unsigned)retry_ms);
                modem_recover_after_mqtt_connect_fail(mqtt_fail_count);
                mqtt_delay_with_wdt(retry_ms);
                continue;
            }

            mqtt_connected = true;
            mqtt_fail_count = 0;
            ESP_LOGI(TAG_4G, "MQTT connected");
            storage_manager_submit_event("MQTT_CONNECTED", "");
            vTaskDelay(pdMS_TO_TICKS(MQTT_POST_CONNECT_SETTLE_MS));
            esp_task_wdt_reset();

            const char *sub_cmd = "AT+MQTTSUB=0,\"command/send/+\",0\r\n";
            if (send_command(sub_cmd, 2000, "OK")) {
                ESP_LOGI(TAG_CMD, "subscribed command topic");
                storage_manager_submit_event("MQTT_SUB_OK", "");
            } else {
                ESP_LOGW(TAG_CMD, "subscribe command topic failed; keep MQTT session");
                storage_manager_submit_event("MQTT_SUB_FAILED", "");
            }
            esp_task_wdt_reset();

            const char *first_heartbeat = "{ \"heartbeat\": 1, \"first\": 1 }\r\n";
            int h_len = strlen(first_heartbeat);
            if (mqtt_publish_payload(first_heartbeat, h_len, "first heartbeat")) {
                ESP_LOGI(TAG_4G, "first heartbeat ok");
                storage_manager_submit_event("MQTT_FIRST_HEARTBEAT_OK", "");
                next_heartbeat_tick = xTaskGetTickCount() + pdMS_TO_TICKS(HEARTBEAT_INTERVAL_MS);
            } else {
                ESP_LOGW(TAG_4G, "first heartbeat failed; keep MQTT session");
                storage_manager_submit_event("MQTT_FIRST_HEARTBEAT_FAILED", "");
                next_heartbeat_tick = xTaskGetTickCount() +
                                      pdMS_TO_TICKS(MQTT_RECONNECT_DELAY_MIN_MS);
            }
        }

        TickType_t now = xTaskGetTickCount();
        if ((int32_t)(now - next_time_sync_tick) >= 0) {
            if (modem_sync_time()) {
                next_time_sync_tick = now + pdMS_TO_TICKS(MODEM_TIME_REFRESH_MS);
            } else {
                next_time_sync_tick = now + pdMS_TO_TICKS(MODEM_TIME_SYNC_RETRY_MS);
            }
            esp_task_wdt_reset();
        }

        if ((int32_t)(now - next_heartbeat_tick) >= 0) {
            const char *heartbeat_json = "{ \"heartbeat\": 1 }\r\n";
            int h_len = strlen(heartbeat_json);
            ESP_LOGI(TAG_4G, "MQTT heartbeat");
            if (mqtt_publish_payload(heartbeat_json, h_len, "MQTT heartbeat")) {
                next_heartbeat_tick = now + pdMS_TO_TICKS(HEARTBEAT_INTERVAL_MS);
            } else {
                storage_manager_submit_event("MQTT_HEARTBEAT_FAILED", "");
                mqtt_connected = false;
                mqtt_fail_count++;
                uint32_t retry_ms = mqtt_reconnect_delay_ms(mqtt_fail_count);
                next_heartbeat_tick = now + pdMS_TO_TICKS(retry_ms);
                mqtt_delay_with_wdt(retry_ms);
                continue;
            }
        }

        if (xQueueReceive(lora_data_queue, &current_data, 0) == pdTRUE) {
            bool success = false;
            char escaped_data[MQTT_ESCAPED_DATA_SIZE];
            if (!json_escape_string(escaped_data, sizeof(escaped_data), current_data.data)) {
                s_mqtt_payload_drop_count++;
                ESP_LOGE(TAG_4G, "MQTT data too long after escape; dropped count=%lu",
                         (unsigned long)s_mqtt_payload_drop_count);
                continue;
            }

            int data_len = snprintf(mqtt_data_buffer, sizeof(mqtt_data_buffer),
                                    "{ \"data\": \"%s\" }\r\n",
                                    escaped_data);
            if (data_len < 0 || data_len >= (int)sizeof(mqtt_data_buffer)) {
                s_mqtt_payload_drop_count++;
                ESP_LOGE(TAG_4G, "MQTT data too long; len=%d cap=%u drop_count=%lu",
                         data_len, (unsigned)sizeof(mqtt_data_buffer),
                         (unsigned long)s_mqtt_payload_drop_count);
                continue;
            }

            success = mqtt_publish_payload(mqtt_data_buffer, data_len, "MQTT publish");

            if (!success) {
                storage_manager_submit_event("MQTT_PUBLISH_FAILED", current_data.data);
                mqtt_connected = false;
                mqtt_requeue_or_drop_oldest(&current_data);
                mqtt_fail_count++;
                mqtt_delay_with_wdt(mqtt_reconnect_delay_ms(mqtt_fail_count));
                continue;
            } else {
                mqtt_fail_count = 0;
                ESP_LOGI(TAG_4G, "MQTT publish ok");
            }
        }

        esp_task_wdt_reset();
        if (uxQueueMessagesWaiting(lora_data_queue) == 0) {
            vTaskDelay(pdMS_TO_TICKS(MQTT_IDLE_DELAY_MS));
        } else {
            taskYIELD();
        }
    }
}

static void self_tag_task(void *pvParameters)
{
    while (1) {
        ESP_LOGI(TAG_SELF, "I'm alive");
        vTaskDelay(pdMS_TO_TICKS(30000));
    }
}

#define UART_RX_TASK_STACK 4096

static void uart_rx_task(void *pvParameters)
{
    static char stream_buf[2048];
    size_t stream_len = 0;
    uint8_t tmp[256];

    ESP_LOGI(TAG_CMD, "UART RX task started");

    while (1) {
        if (uart_mutex != NULL && xSemaphoreTake(uart_mutex, (TickType_t)0) == pdTRUE) {
            int r = uart_read_bytes(UART_NUM, tmp, sizeof(tmp), pdMS_TO_TICKS(20));

            if (r > 0) {
                if (stream_len + r >= sizeof(stream_buf)) {
                    size_t half = stream_len / 2;
                    memmove(stream_buf, stream_buf + half, stream_len - half);
                    stream_len = stream_len - half;
                }

                memcpy(stream_buf + stream_len, tmp, r);
                stream_len += r;
                stream_buf[stream_len] = 0;

                if (strstr(stream_buf, "\"method\"") != NULL &&
                    strstr(stream_buf, "\"reset\"") != NULL) {
                    ESP_LOGW(TAG_CMD, "uart_rx_task detected reset command");
                    xSemaphoreGive(uart_mutex);
                    handle_reset_cmd();
                    stream_len = 0;
                    stream_buf[0] = 0;
                    vTaskDelete(NULL);
                }

                if (stream_len > sizeof(stream_buf) * 3 / 4) {
                    char *last_nl = strrchr(stream_buf, '\n');
                    if (last_nl != NULL) {
                        size_t remain = stream_buf + stream_len - (last_nl + 1);
                        memmove(stream_buf, last_nl + 1, remain);
                        stream_len = remain;
                        stream_buf[stream_len] = 0;
                    }
                }
            }

            xSemaphoreGive(uart_mutex);
        }

        vTaskDelay(pdMS_TO_TICKS(10));
    }
}

extern "C" void app_main(void)
{
    time_utils_init();
    esp_log_level_set(TAG_LORA, ESP_LOG_INFO);
    esp_log_level_set("STORAGE", ESP_LOG_INFO);

    for (int i = 5; i > 0; i--) {
        ESP_LOGI(TAG_BOOT, "waiting modem boot... %d", i);
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
    ESP_LOGI(TAG_BOOT, "initializing");

    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES ||
        ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    lora_data_queue = xQueueCreate(MAX_DATA_QUEUE, sizeof(lora_data_t));
    if (lora_data_queue == NULL) {
        ESP_LOGE(TAG_LORA, "failed to create LoRa queue");
        return;
    }

    uart_init();
    ESP_LOGI(TAG_4G, "UART initialized TX=%d RX=%d", TXD_PIN, RXD_PIN);

    uart_mutex = xSemaphoreCreateMutex();
    if (uart_mutex == NULL) {
        ESP_LOGE(TAG_4G, "failed to create UART mutex");
        return;
    }

    if (lora_driver_init(lora_data_queue) != ESP_OK) {
        ESP_LOGE(TAG_LORA, "LoRa driver init failed");
        return;
    }

    if (storage_manager_start() != ESP_OK) {
        ESP_LOGW(TAG_BOOT, "storage manager start failed; continuing without offline mirror");
    } else {
        storage_manager_submit_event("BOOT", "storage manager started");
    }

    if (lora_driver_start() != ESP_OK) {
        ESP_LOGE(TAG_LORA, "LoRa receive task start failed");
        return;
    }

    xTaskCreatePinnedToCore(mqtt_task, "mqtt_task", 10 * 1024,
                            NULL, 5, NULL, 0);
    xTaskCreatePinnedToCore(self_tag_task, "self_tag", 4096,
                            NULL, 3, NULL, 0);
    xTaskCreatePinnedToCore(uart_rx_task, "uart_rx", UART_RX_TASK_STACK,
                            NULL, 6, NULL, 0);

    ESP_LOGI(TAG_LORA, "LoRa receive task started");
    ESP_LOGI(TAG_4G, "MQTT task started");
    ESP_LOGI(TAG_SELF, "self tag task started");
    ESP_LOGI(TAG_CMD, "UART RX task started");
}
