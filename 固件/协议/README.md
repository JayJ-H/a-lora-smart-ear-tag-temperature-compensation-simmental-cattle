# 3-byte数据包

24 bit载荷由6 bit耳标编号和两路9 bit温度组成，温度分辨率为0.1 ℃。网关解码后补充接收时间、RSSI和SNR。字段分配见`packet_bit_layout.csv`。
