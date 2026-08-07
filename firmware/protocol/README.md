# 3-byte packet

The 24-bit payload contains a 6-bit tag code and two 9-bit temperature codes. Temperature resolution is 0.1 °C. The gateway adds receive time, RSSI, and SNR after decoding. `packet_bit_layout.csv` lists the bit ranges.
