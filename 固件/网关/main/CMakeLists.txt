set(storage_requires esp_driver_usb_serial_jtag)
if(CONFIG_LORA_ENABLE_USB_MSC_STORAGE)
    list(APPEND storage_requires fatfs usb_host_msc)
endif()

idf_component_register(
    SRCS "time_utils.cpp" "storage_manager.cpp" "main.cpp" "lora_driver.cpp"
    INCLUDE_DIRS "."
    REQUIRES esp_driver_gpio esp_driver_spi esp_driver_uart esp_timer nvs_flash radiolib ${storage_requires}
)
