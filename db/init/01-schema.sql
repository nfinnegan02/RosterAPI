CREATE TABLE `staff` (
  `staff_id` int PRIMARY KEY AUTO_INCREMENT,
  `first_name` varchar(50) NOT NULL,
  `last_name` varchar(50) NOT NULL,
  `email` varchar(255) UNIQUE NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `access_level` ENUM ('manager', 'staff') NOT NULL DEFAULT 'staff',
  `min_rest_hours` tinyint NOT NULL DEFAULT 11,
  `max_weekly_hours` tinyint,
  `is_active` bool NOT NULL DEFAULT true,
  `must_change_password` bool NOT NULL DEFAULT false,
  `created_at` datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE `staff_roles` (
  `staff_id` int NOT NULL,
  `role` ENUM ('chef', 'kitchen_porter', 'waiter', 'bartender', 'host', 'receptionist', 'housekeeping') NOT NULL,
  `is_primary` bool NOT NULL DEFAULT false,
  PRIMARY KEY (`staff_id`, `role`)
);

CREATE TABLE `availability` (
  `availability_id` int PRIMARY KEY AUTO_INCREMENT,
  `staff_id` int NOT NULL,
  `day_of_week` tinyint COMMENT '0 = Monday ... 6 = Sunday (recurring)',
  `specific_date` date COMMENT 'one-off date',
  `start_time` time COMMENT 'NULL start/end = whole day',
  `end_time` time,
  `is_available` bool NOT NULL,
  `note` varchar(255)
);

CREATE TABLE `rosters` (
  `roster_id` int PRIMARY KEY AUTO_INCREMENT,
  `week_start` date UNIQUE NOT NULL COMMENT 'always a Monday',
  `status` ENUM ('draft', 'published') NOT NULL DEFAULT 'draft',
  `published_at` datetime,
  `published_by` int,
  `updated_at` datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE `shifts` (
  `shift_id` int PRIMARY KEY AUTO_INCREMENT,
  `roster_id` int NOT NULL,
  `role` ENUM ('chef', 'kitchen_porter', 'waiter', 'bartender', 'host', 'receptionist', 'housekeeping') NOT NULL,
  `staff_id` int COMMENT 'NULL = unfilled shift',
  `start_at` datetime NOT NULL,
  `end_at` datetime NOT NULL,
  `notes` varchar(255)
);

CREATE TABLE `published_shifts` (
  `shift_id` int PRIMARY KEY COMMENT 'same id as the draft shift it was copied from',
  `roster_id` int NOT NULL,
  `role` ENUM ('chef', 'kitchen_porter', 'waiter', 'bartender', 'host', 'receptionist', 'housekeeping') NOT NULL,
  `staff_id` int,
  `start_at` datetime NOT NULL,
  `end_at` datetime NOT NULL,
  `notes` varchar(255)
);

CREATE TABLE `audit_logs` (
  `audit_id` bigint PRIMARY KEY AUTO_INCREMENT,
  `actor_id` int,
  `action` ENUM ('create', 'update', 'delete', 'publish', 'login', 'denied') NOT NULL,
  `entity_type` ENUM ('shift', 'roster', 'availability', 'staff', 'staff_role') NOT NULL,
  `entity_id` int COMMENT 'no FK: can point at different tables',
  `roster_id` int,
  `details` json,
  `created_at` datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE INDEX `idx_shifts_staff_time` ON `shifts` (`staff_id`, `start_at`);

CREATE INDEX `idx_pub_staff_time` ON `published_shifts` (`staff_id`, `start_at`);

CREATE INDEX `idx_audit_entity` ON `audit_logs` (`entity_type`, `entity_id`);

CREATE INDEX `idx_audit_roster` ON `audit_logs` (`roster_id`, `created_at`);

CREATE INDEX `idx_audit_time` ON `audit_logs` (`created_at`);

ALTER TABLE `staff_roles` ADD FOREIGN KEY (`staff_id`) REFERENCES `staff` (`staff_id`) ON DELETE CASCADE;

ALTER TABLE `availability` ADD FOREIGN KEY (`staff_id`) REFERENCES `staff` (`staff_id`) ON DELETE CASCADE;

ALTER TABLE `rosters` ADD FOREIGN KEY (`published_by`) REFERENCES `staff` (`staff_id`) ON DELETE SET NULL;

ALTER TABLE `shifts` ADD FOREIGN KEY (`roster_id`) REFERENCES `rosters` (`roster_id`) ON DELETE CASCADE;

ALTER TABLE `shifts` ADD FOREIGN KEY (`staff_id`) REFERENCES `staff` (`staff_id`) ON DELETE RESTRICT;

ALTER TABLE `published_shifts` ADD FOREIGN KEY (`roster_id`) REFERENCES `rosters` (`roster_id`) ON DELETE CASCADE;

ALTER TABLE `published_shifts` ADD FOREIGN KEY (`staff_id`) REFERENCES `staff` (`staff_id`) ON DELETE RESTRICT;

ALTER TABLE `audit_logs` ADD FOREIGN KEY (`actor_id`) REFERENCES `staff` (`staff_id`) ON DELETE SET NULL;

-- Things dbdiagram can't express
ALTER TABLE `rosters` MODIFY `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE `availability`
  ADD CHECK ((`day_of_week` IS NULL) <> (`specific_date` IS NULL)),
  ADD CHECK (`day_of_week` IS NULL OR `day_of_week` BETWEEN 0 AND 6);

ALTER TABLE `shifts` ADD CHECK (`end_at` > `start_at`);
