# 标识映射与数据接入

耳标通过`tag_registry`和`animal_tag_assignment`关联牛只。MQTT记录完成解码和时间补充后，按当前绑定关系写入`thermal_reading`和`link_metric`。公开分析表使用匿名`CowKey`，不含牧场内部编号映射。
