export type Staff = {
    staff_id: number;
    first_name: string;
    last_name: string;
    email: string;
    password_hash: string;
    access_level: 'manager' | 'staff';
    min_rest_hours: number;
    max_weekly_hours?: number;
    is_active: boolean;
    must_change_password: boolean;
    created_at: Date;
};

// CREATE TABLE `staff` (
//   `staff_id` int PRIMARY KEY AUTO_INCREMENT,
//   `first_name` varchar(50) NOT NULL,
//   `last_name` varchar(50) NOT NULL,
//   `email` varchar(255) UNIQUE NOT NULL,
//   `password_hash` varchar(255) NOT NULL,
//   `access_level` ENUM ('manager', 'staff') NOT NULL DEFAULT 'staff',
//   `min_rest_hours` tinyint NOT NULL DEFAULT 11,
//   `max_weekly_hours` tinyint,
//   `is_active` bool NOT NULL DEFAULT true,
//   `must_change_password` bool NOT NULL DEFAULT false,
//   `created_at` datetime NOT NULL DEFAULT (CURRENT_TIMESTAMP)
// );