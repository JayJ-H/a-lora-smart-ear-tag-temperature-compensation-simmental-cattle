USE cattle_management;

DROP TRIGGER IF EXISTS trg_after_insert_entry_events;
DROP TRIGGER IF EXISTS trg_after_insert_transfer_events;
DROP TRIGGER IF EXISTS trg_after_insert_exit_events;

DELIMITER $$

CREATE TRIGGER trg_after_insert_entry_events
AFTER INSERT ON entry_events
FOR EACH ROW
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cows c WHERE c.cow_number = NEW.cow_number) THEN
    INSERT INTO cows (
      id,
      cow_number,
      ear_tag_number,
      breed,
      gender,
      birth_date,
      current_pen,
      status,
      pregnancy,
      mixing,
      parity,
      created_at,
      updated_at
    )
    VALUES (
      UUID(),
      NEW.cow_number,
      NEW.ear_tag_number,
      COALESCE(NEW.breed, ''),
      COALESCE(NEW.gender, ''),
      NEW.birth_date,
      NEW.pen,
      '健康',
      0,
      0,
      0,
      COALESCE(NEW.created_at, NOW(3)),
      NOW(3)
    );
  ELSE
    SET @nzh_legacy_event_trigger_noop = 1;
  END IF;
END$$

CREATE TRIGGER trg_after_insert_transfer_events
AFTER INSERT ON transfer_events
FOR EACH ROW
BEGIN
  SET @nzh_legacy_event_trigger_noop = 1;
END$$

CREATE TRIGGER trg_after_insert_exit_events
AFTER INSERT ON exit_events
FOR EACH ROW
BEGIN
  SET @nzh_legacy_event_trigger_noop = 1;
END$$

DELIMITER ;
