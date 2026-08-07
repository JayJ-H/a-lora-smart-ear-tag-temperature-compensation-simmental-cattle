# ESP-IDF build-system reference: https://docs.espressif.com/projects/esp-idf/en/v5.4.2/esp32s3/api-guides/build-system.html#minimal-cmake
cmake_minimum_required(VERSION 3.16)

# Include the ESP-IDF build system.
include($ENV{IDF_PATH}/tools/cmake/project.cmake)

# Set the project name.
project(eps14pro)
