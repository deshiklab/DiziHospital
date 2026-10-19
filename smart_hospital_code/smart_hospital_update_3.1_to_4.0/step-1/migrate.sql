-- Smart Hospital DB
-- Version 4.0
-- https://smart-hospital.in
-- https://qdocs.in
-- New tables added: 50


-- --------------------------------------------------------

TRUNCATE TABLE `opd_details`;
TRUNCATE TABLE `pathology_report`;
TRUNCATE TABLE `pathology_report_parameterdetails`;
TRUNCATE TABLE `patient_timeline`;
TRUNCATE TABLE `pharmacy_bill_basic`;
TRUNCATE TABLE `radiology_report`;
TRUNCATE TABLE `radiology_report_parameterdetails`;
TRUNCATE TABLE `conferences`;
TRUNCATE TABLE `medicine_batch_details`;
TRUNCATE TABLE `ipd_prescription_details`;
TRUNCATE TABLE `ipd_details`;
TRUNCATE TABLE `ipd_prescription_basic`;
TRUNCATE TABLE `appointment`;
TRUNCATE TABLE `consultant_register`;
TRUNCATE TABLE `patient_charges`;
TRUNCATE TABLE `conference_staff`;
TRUNCATE TABLE `pharmacy_bill_detail`;
TRUNCATE TABLE `birth_report`;
TRUNCATE TABLE `blood_issue`;
TRUNCATE TABLE `charges`;   
TRUNCATE TABLE `charge_categories`;   
TRUNCATE TABLE `medicine_dosage`;
TRUNCATE TABLE `radio`;
TRUNCATE TABLE `staff_leave_details`;
TRUNCATE TABLE `staff_leave_request`;
TRUNCATE TABLE `conferences_history`;
TRUNCATE TABLE `operation_theatre`;
TRUNCATE TABLE `organisations_charges`;
TRUNCATE TABLE `pathology`;
TRUNCATE TABLE `pathology_parameterdetails`;
TRUNCATE TABLE `pharmacy`;
TRUNCATE TABLE `medicine_bad_stock`;
TRUNCATE TABLE `radiology_parameterdetails`;
TRUNCATE TABLE `read_systemnotification`;
TRUNCATE TABLE `ambulance_call`;
drop TABLE enquiry;
drop TABLE enquiry_type;
drop TABLE follow_up;
drop TABLE ot_consultant_register;
drop TABLE discharged_summary_opd;
drop TABLE discharged_summary;
drop table payment;
drop table supplier_bill_detail;
drop table tpa_doctorcharges;
drop table tpa_master;
drop table test_type_report;
drop table blood_bank_status;
drop table ipd_billing;
drop table opd_billing;
drop table opd_patient_charges;
drop table opd_payment;
drop table prescription;
drop table supplier_category;
drop table diagnosis;
drop table permission_group;
drop table permission_category;
drop table roles_permissions;
drop table charge_type_master;

CREATE TABLE `blood_bank_products` (
    `id` int primary key auto_increment,
    `name` varchar(255) NOT NULL,
    `is_blood_group` int(11) DEFAULT '1',
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `logs` (
    `id` int primary key auto_increment,
    `message` text DEFAULT NULL,
    `record_id` int(11) NOT NULL,
    `user_id` int(11) DEFAULT NULL,
    `action` varchar(50) NOT NULL,
    `ip_address` varchar(50) NOT NULL,
    `platform` varchar(50) NOT NULL,
    `agent` varchar(50) NOT NULL,
    `time` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `created_at` date DEFAULT NULL,
    FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `charge_type_master` (
    `id` int(11) NOT NULL,
    `charge_type` varchar(200) NOT NULL,
    `is_default` varchar(10) NOT NULL,
    `is_active` varchar(10) NOT NULL,
    `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

ALTER TABLE `charge_type_master`
    ADD PRIMARY KEY (`id`);

ALTER TABLE `charge_type_master`
    MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=13;

CREATE TABLE `charge_type_module` (
    `id` int(11) NOT NULL,
    `charge_type_master_id` int(11) DEFAULT NULL,
    `module_shortcode` varchar(50) DEFAULT NULL,
    `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

ALTER TABLE `charge_type_module`
    ADD PRIMARY KEY (`id`),
    ADD KEY `charge_type_master_id` (`charge_type_master_id`);

ALTER TABLE `charge_type_module`
    MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=28;
  
ALTER TABLE `charge_type_module`
    ADD CONSTRAINT `charge_type_module_ibfk_1` FOREIGN KEY (`charge_type_master_id`) REFERENCES `charge_type_master` (`id`) ON DELETE CASCADE;

CREATE TABLE `charge_units` (
    `id` int primary key auto_increment,
    `unit` varchar(50) DEFAULT NULL,
    `is_active` int(1) DEFAULT '0',
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `chat_connections` (
    `id` int primary key auto_increment,
    `chat_user_one` int(11) NOT NULL,
    `chat_user_two` int(11) NOT NULL,
    `ip` varchar(30) DEFAULT NULL,
    `time` int(11) DEFAULT NULL,
    `created_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
    `updated_at` date DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `chat_messages` (
    `id` int primary key auto_increment,
    `message` text DEFAULT NULL,
    `chat_user_id` int(11) NOT NULL,
    `ip` varchar(30) NOT NULL,
    `time` int(11) NOT NULL,
    `is_first` int(1) DEFAULT 0,
    `is_read` int(1) NOT NULL DEFAULT 0,
    `chat_connection_id` int(11) NOT NULL,
    `created_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `chat_users` (
    `id` int primary key auto_increment,
    `user_type` varchar(20) DEFAULT NULL,
    `staff_id` int(11) DEFAULT NULL,
    `patient_id` int(11) DEFAULT NULL,
    `create_staff_id` int(11) DEFAULT NULL,
    `create_patient_id` int(11) DEFAULT NULL,
    `is_active` int(11) DEFAULT 0,
    `created_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
    `updated_at` date DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `appointment_payment` (
    `id` int primary key auto_increment,
    `appointment_id` int(11) DEFAULT NULL,
    `charge_id` int(11) DEFAULT NULL,
    `paid_amount` float(10,2) NOT NULL,
    `payment_mode` varchar(50) DEFAULT NULL,
    `payment_type` varchar(100) NOT NULL,
    `transaction_id` varchar(255) DEFAULT NULL,
    `note` varchar(100) DEFAULT NULL,
    `date` datetime NOT NULL,
    FOREIGN KEY (`appointment_id`) REFERENCES `appointment` (`id`) ON DELETE CASCADE,
    FOREIGN KEY (`charge_id`) REFERENCES `charges` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `captcha` (
    `id` int primary key auto_increment,
    `name` varchar(250) NOT NULL,
    `status` int(11) NOT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `case_references` (
    `id` int primary key auto_increment,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `certificates` (
    `id` int primary key auto_increment,
    `certificate_name` varchar(100) NOT NULL,
    `certificate_text` text DEFAULT NULL,
    `left_header` varchar(100) NOT NULL,
    `center_header` varchar(100) NOT NULL,
    `right_header` varchar(100) NOT NULL,
    `left_footer` varchar(100) NOT NULL,
    `right_footer` varchar(100) NOT NULL,
    `center_footer` varchar(100) NOT NULL,
    `background_image` varchar(100) NOT NULL,
    `created_for` tinyint(1) NOT NULL COMMENT '1 = staff, 2 = patients',
    `status` tinyint(1) NOT NULL,
    `header_height` int(11) NOT NULL,
    `content_height` int(11) NOT NULL,
    `footer_height` int(11) NOT NULL,
    `content_width` int(11) NOT NULL,
    `enable_patient_image` tinyint(1) NOT NULL COMMENT '0=no,1=yes',
    `enable_image_height` int(11) NOT NULL,
    `updated_at` date DEFAULT NULL,
    `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `discharge_card` (
    `id` int primary key auto_increment,
    `case_reference_id` int(11) DEFAULT NULL,
    `opd_details_id` int(11) DEFAULT NULL,
    `ipd_details_id` int(11) DEFAULT NULL,
    `discharge_by` int(11) DEFAULT NULL,
    `discharge_date` datetime DEFAULT NULL,
    `discharge_status` int(10) NOT NULL,
    `death_date` datetime DEFAULT NULL,
    `refer_date` datetime DEFAULT NULL,
    `refer_to_hospital` varchar(255) DEFAULT NULL,
    `reason_for_referral` varchar(255) DEFAULT NULL,
    `operation` varchar(225) NOT NULL,
    `diagnosis` varchar(255) NOT NULL,
    `investigations` text DEFAULT NULL,
    `treatment_home` varchar(255) NOT NULL,
    `note` text DEFAULT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (`ipd_details_id`) REFERENCES `ipd_details` (`id`) ON DELETE CASCADE,
    FOREIGN KEY (`discharge_by`) REFERENCES `staff` (`id`) ON DELETE CASCADE,
    FOREIGN KEY (`case_reference_id`) REFERENCES `case_references` (`id`) ON DELETE CASCADE,
    FOREIGN KEY (`opd_details_id`) REFERENCES `opd_details` (`id`) ON DELETE CASCADE,
    FOREIGN KEY (`ipd_details_id`) REFERENCES `ipd_details` (`id`) ON DELETE CASCADE,
    FOREIGN KEY (`discharge_by`) REFERENCES `staff` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `doctor_absent` (
    `id` int primary key auto_increment,
    `staff_id` int(11) DEFAULT NULL,
    `date` date NOT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `dose_duration` (
    `id` int primary key auto_increment,
    `name` varchar(255) NOT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `dose_interval` (
    `id` int primary key auto_increment,
    `name` varchar(255) NOT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `finding_category` (
    `id` int primary key auto_increment,
    `category` varchar(100) NOT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `finding` (
    `id` int primary key auto_increment,
    `name` varchar(200) NOT NULL,
    `description` text DEFAULT NULL,
    `finding_category_id` int(11) DEFAULT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (`finding_category_id`) REFERENCES `finding_category` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `global_shift` (
    `id` int primary key auto_increment,
    `name` varchar(250)  NOT NULL,
    `start_time` time NOT NULL,
    `end_time` time NOT NULL,
    `date_created` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `doctor_global_shift` (
    `id` int primary key auto_increment,
    `staff_id` int(11) DEFAULT NULL,
    `global_shift_id` int(11) DEFAULT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (`global_shift_id`) REFERENCES `global_shift` (`id`) ON DELETE CASCADE,
    FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `doctor_shift` (
    `id` int primary key auto_increment,
    `day` varchar(20) DEFAULT NULL,
    `staff_id` int(11) DEFAULT NULL,
    `global_shift_id` int(11) DEFAULT NULL,
    `start_time` time DEFAULT NULL,
    `end_time` time DEFAULT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (`global_shift_id`) REFERENCES `global_shift` (`id`) ON DELETE CASCADE,
    FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `ipd_doctors` (
    `id` int primary key auto_increment,
    `ipd_id` int(11) NOT NULL,
    `consult_doctor` int(11) NOT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (`ipd_id`) REFERENCES `ipd_details` (`id`) ON DELETE CASCADE,
    FOREIGN KEY (`consult_doctor`) REFERENCES `staff` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `ipd_prescription_test` (
    `id` int primary key auto_increment,
    `ipd_prescription_basic_id` int(100) DEFAULT NULL,
    `pathology_id` int(11) DEFAULT NULL,
    `radiology_id` int(11) DEFAULT NULL,
    `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`ipd_prescription_basic_id`) REFERENCES `ipd_prescription_basic` (`id`) ON DELETE CASCADE,
    FOREIGN KEY (`pathology_id`) REFERENCES `pathology` (`id`) ON DELETE CASCADE,
    FOREIGN KEY (`radiology_id`) REFERENCES `radio` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `medication_report` (
    `id` int primary key auto_increment,
    `medicine_dosage_id` int(11) DEFAULT NULL,
    `pharmacy_id` int(11) DEFAULT NULL,
    `opd_details_id` int(11) DEFAULT NULL,
    `ipd_id` int(11) DEFAULT NULL,
    `date` date NOT NULL,
    `time` time NOT NULL,
    `remark` text DEFAULT NULL,
    `generated_by` int(11) DEFAULT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (`generated_by`) REFERENCES `staff` (`id`) ON DELETE CASCADE,
    FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacy` (`id`) ON DELETE CASCADE,
    FOREIGN KEY (`ipd_id`) REFERENCES `ipd_details` (`id`) ON DELETE CASCADE,
    FOREIGN KEY (`medicine_dosage_id`) REFERENCES `medicine_dosage` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `nurse_note` (
    `id` int primary key auto_increment,
    `date` datetime NOT NULL,
    `ipd_id` int(11) DEFAULT NULL,
    `staff_id` int(11) DEFAULT NULL,
    `note` text DEFAULT NULL,
    `comment` text DEFAULT NULL,
    `updated_at` datetime NOT NULL,
    FOREIGN KEY (`ipd_id`) REFERENCES `ipd_details` (`id`) ON DELETE CASCADE,
    FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `nurse_notes_comment` (
    `id` int primary key auto_increment,
    `nurse_note_id` int(11) DEFAULT NULL,
    `comment_staffid` int(11) DEFAULT NULL,
    `comment_staff` text DEFAULT NULL,
    `created_at` datetime NOT NULL,
    FOREIGN KEY (`nurse_note_id`) REFERENCES `nurse_note` (`id`) ON DELETE CASCADE,
    FOREIGN KEY (`comment_staffid`) REFERENCES `staff` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `patient_id_card` (
    `id` int primary key auto_increment,
    `title` varchar(100) NOT NULL,
    `hospital_name` varchar(100) NOT NULL,
    `hospital_address` varchar(500) NOT NULL,
    `background` varchar(100) NOT NULL,
    `logo` varchar(100) NOT NULL,
    `sign_image` varchar(100) NOT NULL,
    `header_color` varchar(100) NOT NULL,
    `enable_patient_name` tinyint(1) NOT NULL COMMENT '0=disable,1=enable',
    `enable_guardian_name` tinyint(1) NOT NULL COMMENT '0=disable,1=enable',
    `enable_patient_unique_id` tinyint(1) NOT NULL COMMENT '0=disable,1=enable',
    `enable_address` tinyint(1) NOT NULL COMMENT '0=disable,1=enable',
    `enable_phone` tinyint(1) NOT NULL COMMENT '0=disable,1=enable',
    `enable_dob` tinyint(1) NOT NULL COMMENT '0=disable,1=enable',
    `enable_blood_group` tinyint(1) NOT NULL COMMENT '0=disable,1=enable',
    `status` tinyint(1) NOT NULL COMMENT '0=disable,1=enable',
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `prefixes` (
    `id` int primary key auto_increment,
    `type` varchar(100) DEFAULT NULL,
    `prefix` varchar(20) DEFAULT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `referral_category` (
    `id` int primary key auto_increment,
    `name` varchar(100) NOT NULL,
    `is_active` int(11) NOT NULL DEFAULT '1',
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `referral_person` (
    `id` int primary key auto_increment,
    `name` varchar(100)  NOT NULL,
    `category_id` int(11) DEFAULT NULL,
    `contact` varchar(20)  DEFAULT NULL,
    `person_name` varchar(100)  DEFAULT NULL,
    `person_phone` varchar(50)  DEFAULT NULL,
    `standard_commission` float(10,2) NOT NULL DEFAULT '0.00',
    `address` varchar(100)  DEFAULT NULL,
    `is_active` int(11) NOT NULL DEFAULT '1',
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`category_id`) REFERENCES `referral_category` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `referral_type` (
    `id` int primary key auto_increment,
    `name` varchar(100)  NOT NULL,
    `prefixes_type` varchar(100) NOT NULL,
    `is_active` int(11) NOT NULL DEFAULT '1',
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `referral_person_commission` (
    `id` int primary key auto_increment,
    `referral_person_id` int(11) DEFAULT NULL,
    `referral_type_id` int(11) DEFAULT NULL,
    `commission` float(10,2) NOT NULL DEFAULT '0.00',
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`referral_person_id`) REFERENCES `referral_person` (`id`) ON DELETE CASCADE,
    FOREIGN KEY (`referral_type_id`) REFERENCES `referral_type` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `shift_details` (
    `id` int primary key auto_increment,
    `staff_id` int(11) DEFAULT NULL,
    `consult_duration` int(11) DEFAULT NULL,
    `charge_id` int(11) DEFAULT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE,
FOREIGN KEY (`charge_id`) REFERENCES `charges` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `staff_id_card` (
    `id` int primary key auto_increment,
    `title` varchar(255) NOT NULL,
    `hospital_name` varchar(255) NOT NULL,
    `hospital_address` varchar(255) NOT NULL,
    `background` varchar(100) NOT NULL,
    `logo` varchar(100) NOT NULL,
    `sign_image` varchar(100) NOT NULL,
    `header_color` varchar(100) NOT NULL,
    `enable_staff_role` tinyint(1) NOT NULL COMMENT '0=disable,1=enable',
    `enable_staff_id` tinyint(1) NOT NULL COMMENT '0=disable,1=enable',
    `enable_staff_department` tinyint(1) NOT NULL COMMENT '0=disable,1=enable',
    `enable_designation` tinyint(1) NOT NULL COMMENT '0=disable,1=enable',
    `enable_name` tinyint(1) NOT NULL COMMENT '0=disable,1=enable',
    `enable_fathers_name` tinyint(1) NOT NULL COMMENT '0=disable,1=enable',
    `enable_mothers_name` tinyint(1) NOT NULL COMMENT '0=disable,1=enable',
    `enable_date_of_joining` tinyint(1) NOT NULL COMMENT '0=disable,1=enable',
    `enable_permanent_address` tinyint(1) NOT NULL COMMENT '0=disable,1=enable',
    `enable_staff_dob` tinyint(1) NOT NULL COMMENT '0=disable,1=enable',
    `enable_staff_phone` tinyint(1) NOT NULL COMMENT '0=disable,1=enable',
    `status` tinyint(1) NOT NULL COMMENT '0=disable,1=enable',
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `medicine_supplier` (
    `id` int primary key auto_increment,
    `supplier` varchar(200) NOT NULL,
    `contact` varchar(200) NOT NULL,
    `supplier_person` varchar(200) NOT NULL,
    `supplier_person_contact` varchar(200) NOT NULL,
    `supplier_drug_licence` varchar(200) NOT NULL,
    `address` varchar(200) NOT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `system_notification_setting` (
    `id` int(11) NOT NULL,
    `event` varchar(100) NOT NULL,
    `subject` varchar(255) NOT NULL,
    `staff_message` text DEFAULT NULL,
    `is_staff` int(1) NOT NULL DEFAULT 1,
    `patient_message` text DEFAULT NULL,
    `is_patient` int(1) NOT NULL DEFAULT 0,
    `variables` text DEFAULT NULL,
    `url` varchar(255) NOT NULL,
    `patient_url` varchar(255) NOT NULL,
    `notification_type` varchar(255) NOT NULL,
    `is_active` int(1) NOT NULL DEFAULT 1,
    `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

ALTER TABLE `system_notification_setting`
    ADD PRIMARY KEY (`id`);

ALTER TABLE `system_notification_setting`
    MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=60;
  
CREATE TABLE `tax_category` (
    `id` int primary key auto_increment,
    `name` varchar(255) NOT NULL,
    `percentage` float(10,2) DEFAULT '0.00',
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `transactions` (
    `id` int primary key auto_increment,
    `type` varchar(100) DEFAULT NULL,
    `section` varchar(50) NOT NULL,
    `patient_id` int(11) DEFAULT NULL,
    `case_reference_id` int(11) DEFAULT NULL,
    `opd_id` int(11) DEFAULT NULL,
    `ipd_id` int(11) DEFAULT NULL,
    `pharmacy_bill_basic_id` int(11) DEFAULT NULL,
    `pathology_billing_id` int(11) DEFAULT NULL,
    `radiology_billing_id` int(11) DEFAULT NULL,
    `blood_donor_cycle_id` int(11) DEFAULT NULL,
    `blood_issue_id` int(11) DEFAULT NULL,
    `ambulance_call_id` int(11) DEFAULT NULL,
    `appointment_id` int(11) DEFAULT NULL,
    `attachment` varchar(250) DEFAULT NULL,
    `attachment_name` text,
    `amount_type` varchar(10) DEFAULT NULL,
    `amount` float(10,2) DEFAULT NULL,
    `payment_mode` varchar(100) DEFAULT NULL,
    `cheque_no` varchar(100) DEFAULT NULL,
    `cheque_date` date DEFAULT NULL,
    `payment_date` datetime DEFAULT NULL,
    `note` text,
    `received_by` int(11) DEFAULT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `appointment_queue` (
    `id` int primary key auto_increment,
    `appointment_id` int(11) DEFAULT NULL,
    `staff_id` int(11) DEFAULT NULL,
    `position` int(11) DEFAULT NULL,
    `shift_id` int(11) DEFAULT NULL,
    `date` date NOT NULL DEFAULT '2021-01-11',
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (`appointment_id`) REFERENCES `appointment` (`id`) ON DELETE CASCADE,
    FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE,
    FOREIGN KEY (`shift_id`) REFERENCES `doctor_shift` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `pathology_billing` (
    `id` int primary key auto_increment,
    `case_reference_id` int(11) DEFAULT NULL,
    `ipd_prescription_basic_id` int(11) DEFAULT NULL,
    `date` datetime DEFAULT NULL,
    `patient_id` int(11) DEFAULT NULL,
    `doctor_id` int(11) DEFAULT NULL,
    `doctor_name` varchar(100) NOT NULL,
    `total` float(10,2) DEFAULT '0.00',
    `discount_percentage` float(10,2) DEFAULT '0.00',
    `discount` float(10,2) DEFAULT '0.00',
    `tax_percentage` float(10,2) DEFAULT '0.00',
    `tax` float(10,2) DEFAULT '0.00',
    `net_amount` float(10,2) DEFAULT '0.00',
    `transaction_id` int(11) DEFAULT NULL,
    `note` text DEFAULT NULL,
    `generated_by` int(11) DEFAULT NULL,
    `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `updated_at` datetime DEFAULT NULL,
    FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`) ON DELETE CASCADE,
    FOREIGN KEY (`doctor_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE,
    FOREIGN KEY (`case_reference_id`) REFERENCES `case_references` (`id`) ON DELETE CASCADE,
    FOREIGN KEY (`transaction_id`) REFERENCES `transactions` (`id`) ON DELETE SET NULL,
    FOREIGN KEY (`generated_by`) REFERENCES `staff` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `radiology_billing` (
    `id` int primary key auto_increment,
    `patient_id` int(11) DEFAULT NULL,
    `case_reference_id` int(11) DEFAULT NULL,
    `ipd_prescription_basic_id` int(11) DEFAULT NULL,
    `doctor_id` int(11) DEFAULT NULL,
    `date` datetime DEFAULT NULL,
    `doctor_name` varchar(100) NOT NULL,
    `total` float(10,2) NOT NULL,
    `discount_percentage` float(10,2) NOT NULL,
    `discount` float(10,2) NOT NULL,
    `tax_percentage` float(10,2) NOT NULL,
    `tax` float(10,2) NOT NULL,
    `net_amount` float(10,2) NOT NULL,
    `transaction_id` int(11) DEFAULT NULL,
    `note` text DEFAULT NULL,
    `generated_by` int(11) DEFAULT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,  
    `updated_at` datetime DEFAULT NULL,
    FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`) ON DELETE CASCADE,
    FOREIGN KEY (`case_reference_id`) REFERENCES `case_references` (`id`) ON DELETE CASCADE,
    FOREIGN KEY (`doctor_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE,
    FOREIGN KEY (`transaction_id`) REFERENCES `transactions` (`id`) ON DELETE SET NULL,
    FOREIGN KEY (`generated_by`) REFERENCES `staff` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `referral_commission` (
    `id` int primary key auto_increment,
    `referral_category_id` int(11) DEFAULT NULL,
    `referral_type_id` int(11) DEFAULT NULL,
    `commission` float DEFAULT NULL,
    `is_active` int(11) NOT NULL DEFAULT '1',
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`referral_category_id`) REFERENCES `referral_category` (`id`) ON DELETE CASCADE,
    FOREIGN KEY (`referral_type_id`) REFERENCES `referral_type` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `referral_payment` (
    `id` int primary key auto_increment,
    `referral_person_id` int(11) DEFAULT NULL,
    `patient_id` int(11) DEFAULT NULL,
    `referral_type` int(11) DEFAULT NULL,
    `billing_id` int(11) NOT NULL,
    `bill_amount` float(10,2) DEFAULT '0.00',
    `percentage` float(10,2) DEFAULT '0.00',
    `amount` float(10,2) DEFAULT '0.00',
    `date` datetime NOT NULL,
    FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`) ON DELETE CASCADE,
    FOREIGN KEY (`referral_person_id`) REFERENCES `referral_person` (`id`) ON DELETE CASCADE,
    FOREIGN KEY (`referral_type`) REFERENCES `referral_type` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `operation` (
    `id` int primary key auto_increment,
    `operation` varchar(250) NOT NULL,
    `category_id` int(11) DEFAULT NULL,
    `is_active` varchar(10) NOT NULL,
    `created_at` date NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `operation_category` (
    `id` int primary key auto_increment,
    `category` varchar(250) NOT NULL,
    `is_active` varchar(10) NOT NULL,
    `created_at` date NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `patient_bed_history` (
    `id` int primary key auto_increment,
    `case_reference_id` int(11) DEFAULT NULL,
    `bed_group_id` int(11) DEFAULT NULL,
    `bed_id` int(11) DEFAULT NULL,
    `revert_reason` text DEFAULT NULL,
    `from_date` datetime DEFAULT NULL,
    `to_date` datetime DEFAULT NULL,
    `is_active` varchar(20) DEFAULT NULL,
    `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

CREATE TABLE `permission_group` (
    `id` int(11) NOT NULL,
    `name` varchar(100) DEFAULT NULL,
    `short_code` varchar(100) NOT NULL,
    `is_active` int(11) DEFAULT 0,
    `system` int(11) NOT NULL,
    `sort_order` decimal(10,2) NOT NULL,
    `created_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

ALTER TABLE `permission_group`
    ADD PRIMARY KEY (`id`);
  
ALTER TABLE `permission_group`
    MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=44;

CREATE TABLE `permission_category` (
    `id` int(11) NOT NULL,
    `perm_group_id` int(11) DEFAULT NULL,
    `name` varchar(100) DEFAULT NULL,
    `short_code` varchar(100) DEFAULT NULL,
    `enable_view` int(11) DEFAULT 0,
    `enable_add` int(11) DEFAULT 0,
    `enable_edit` int(11) DEFAULT 0,
    `enable_delete` int(11) DEFAULT 0,
    `created_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

ALTER TABLE `permission_category`
    ADD PRIMARY KEY (`id`);

ALTER TABLE `permission_category`
    MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=372;

CREATE TABLE `roles_permissions` (
    `id` int(11) NOT NULL,
    `role_id` int(11) DEFAULT NULL,
    `perm_cat_id` int(11) DEFAULT NULL,
    `can_view` int(11) DEFAULT NULL,
    `can_add` int(11) DEFAULT NULL,
    `can_edit` int(11) DEFAULT NULL,
    `can_delete` int(11) DEFAULT NULL,
    `created_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

ALTER TABLE `roles_permissions`
    ADD PRIMARY KEY (`id`);

ALTER TABLE `roles_permissions`
    MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2292;

CREATE TABLE `permission_patient` (
    `id` int(11) NOT NULL,
    `permission_group_short_code` varchar(100) NOT NULL,
    `name` varchar(100) NOT NULL,
    `short_code` varchar(100) NOT NULL,
    `is_active` int(11) DEFAULT NULL,
    `system` int(11) NOT NULL,
    `sort_order` decimal(10,2) NOT NULL,
    `created_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

ALTER TABLE `permission_patient`
    ADD PRIMARY KEY (`id`);

ALTER TABLE `permission_patient`
    MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=10;  

ALTER TABLE ambulance_call
    DROP COLUMN  `bill_no` ,
    DROP COLUMN  `patient_name`,
    DROP COLUMN `vehicle_no`,
    ADD `patient_id` int(11) NOT NULL AFTER id,
    ADD `case_reference_id` int(11) DEFAULT NULL  AFTER patient_id,
    ADD `vehicle_id` int(11) DEFAULT NULL AFTER case_reference_id,
    ADD `charge_category_id` int(11) DEFAULT NULL AFTER call_to,
    ADD `charge_id` int(11) DEFAULT NULL AFTER charge_category_id,
    ADD `standard_charge` int(11) DEFAULT NULL AFTER charge_id,
    ADD `tax_percentage` float(10,2) DEFAULT NULL AFTER standard_charge,
    ADD `net_amount` float(10,2) DEFAULT NULL AFTER amount,
    ADD `transaction_id` int(11) DEFAULT NULL AFTER net_amount,
    ADD `note` text AFTER transaction_id;

ALTER TABLE appointment
    ADD  `case_reference_id` int(11) DEFAULT NULL AFTER patient_id,
    ADD `visit_details_id` int(11) DEFAULT NULL AFTER case_reference_id,
    ADD `time` time DEFAULT NULL AFTER date,
    ADD `is_opd` varchar(10) NOT NULL AFTER source,
    ADD `is_ipd` varchar(10) NOT NULL AFTER is_opd,
    ADD `global_shift_id` int(11) DEFAULT NULL AFTER is_ipd,
    ADD `shift_id` int(11) DEFAULT NULL AFTER global_shift_id,
    ADD `is_queue` int(11) DEFAULT NULL AFTER shift_id,
    ADD `live_consult` varchar(50) NOT NULL AFTER is_queue,
    DROP COLUMN `is_opd`,
    DROP COLUMN `is_ipd`,
    DROP COLUMN `appointment_no`,
    DROP COLUMN `patient_name`,
    DROP COLUMN `gender`,
    DROP COLUMN `email`,
    DROP COLUMN `mobileno`,
    DROP COLUMN `live_consult`;

ALTER TABLE bed_group
    ADD `color` varchar(50) NOT NULL DEFAULT '#f4f4f4' AFTER name,
    ADD `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

Alter TABLE bed_type
    ADD `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

Alter TABLE birth_report
    DROP COLUMN `ref_no`,
    DROP COLUMN `opd_ipd_no`,
    DROP COLUMN  `mother_name`,
    MODIFY `birth_report` mediumtext NOT NULL,
    ADD `patient_id` int(11) DEFAULT NULL AFTER weight,
    ADD `case_reference_id` int(11) DEFAULT NULL AFTER patient_id;

ALTER TABLE `birth_report`
    ADD FOREIGN KEY (`case_reference_id`) REFERENCES `case_references` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`) ON DELETE CASCADE;

Alter TABLE blood_donor
    Drop COLUMN `age`,
    Drop COLUMN `month`,
    Drop COLUMN `blood_group`,
    ADD `date_of_birth` date DEFAULT NULL AFTER donor_name,
    ADD `blood_bank_product_id` int(11) DEFAULT NULL AFTER date_of_birth;  

ALTER TABLE blood_donor_cycle
    MODIFY   `blood_donor_id` int(11) DEFAULT NULL,
    Add `blood_donor_cycle_id` int(11) NOT NULL AFTER id,
    Add `blood_bank_product_id` int(11) DEFAULT NULL AFTER blood_donor_cycle_id,
    Add `charge_id` int(11) DEFAULT NULL AFTER blood_donor_id,
    ADD `note` text AFTER institution,
    ADD `discount_percentage` float(10,2) DEFAULT '0.00' AFTER note,
    ADD `tax_percentage` float(10,2) DEFAULT '0.00' AFTER discount_percentage,
    Add `standard_charge` float(10,2) DEFAULT NULL AFTER quantity,
    Add `apply_charge` float(10,2) DEFAULT NULL AFTER standard_charge,
    Add `amount` float(10,2) DEFAULT NULL AFTER apply_charge;

ALTER TABLE blood_issue
    DROP COLUMN `donor_name`,
    DROP COLUMN `lot`,
    DROP COLUMN `bag_no`,
    DROP COLUMN `bill_no`,
    DROP COLUMN  `recieve_to`,
    DROP COLUMN `blood_group`,
    DROP COLUMN `gender`,
    DROP COLUMN `doctor` ,
    MODIFY `amount` float(10,2) DEFAULT NULL,
    MODIFY `generated_by` int(11) DEFAULT NULL, 
    ADD `patient_id` int(11) NOT NULL AFTER id,
    ADD `case_reference_id` int(11) DEFAULT NULL AFTER patient_id,
    ADD `blood_donor_cycle_id` int(11) DEFAULT NULL AFTER case_reference_id,
    ADD `hospital_doctor` int(11) DEFAULT NULL after date_of_issue,
    ADD `reference` varchar(200) DEFAULT NULL after hospital_doctor,
    ADD `charge_id` int(11) DEFAULT NULL after reference,
    ADD `standard_charge` int(11) NOT NULL after charge_id,
    ADD `tax_percentage` float(10,2) NOT NULL after standard_charge,
    ADD `discount_percentage` float(10,2) DEFAULT '0.00' after tax_percentage,
    ADD `net_amount` float(10,2) NOT NULL after amount;

ALTER TABLE `blood_issue`
    ADD FOREIGN KEY (`case_reference_id`) REFERENCES `case_references` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`blood_donor_cycle_id`) REFERENCES `blood_donor_cycle` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`charge_id`) REFERENCES `charges` (`id`) ON DELETE CASCADE;

Alter TABLE charges
    DROP COLUMN `charge_type`,
    DROP COLUMN `code`,
    DROP COLUMN charge_category,
    MODIFY `description` mediumtext DEFAULT NULL,
    ADD  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP after status,
    ADD `charge_category_id` int(11) DEFAULT NULL AFTER id,
    ADD `tax_category_id` int(11) DEFAULT NULL AFTER charge_category_id,
    ADD `charge_unit_id` int(10) DEFAULT NULL AFTER tax_category_id,
    ADD `name` varchar(200) NOT NULL AFTER charge_unit_id;

ALTER TABLE `charges`
    ADD FOREIGN KEY (`charge_category_id`) REFERENCES `charge_categories` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`tax_category_id`) REFERENCES `tax_category` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`charge_unit_id`) REFERENCES `charge_units` (`id`) ON DELETE CASCADE;

Alter TABLE charge_categories
    ADD `charge_type_id` int(11) DEFAULT NULL AFTER id,
    ADD `short_code` varchar(30) DEFAULT NULL AFTER description,
    ADD `is_default` varchar(10) NOT NULL AFTER description,
    ADD `created_at` timestamp NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
    DROP COLUMN `charge_type`;
 
ALTER TABLE `charge_categories`
    ADD FOREIGN KEY (`charge_type_id`) REFERENCES `charge_type_master` (`id`) ON DELETE CASCADE; 

ALTER TABLE complaint
    DROP COLUMN `complaint_type`,
    MODIFY `note` text DEFAULT NULL,
    ADD `complaint_type_id` int(11) DEFAULT NULL after id,
    ADD `created_at` timestamp NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP after image;

ALTER TABLE complaint_type
    MODIFY `description` mediumtext DEFAULT NULL;

ALTER TABLE `complaint`
    ADD FOREIGN KEY (`complaint_type_id`) REFERENCES `complaint_type` (`id`) ON DELETE CASCADE;

ALTER TABLE conferences DROP COLUMN `opd_id`,
    MODIFY   `return_response` text DEFAULT NULL,
    MODIFY `api_type` varchar(50) NOT NULL,
    ADD `visit_details_id` int(11) DEFAULT NULL after patient_id;

ALTER TABLE consultant_register DROP COLUMN  `patient_id` ,
    ADD `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP after cons_doctor;

ALTER TABLE `consultant_register`
    ADD FOREIGN KEY (`ipd_id`) REFERENCES `ipd_details` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`cons_doctor`) REFERENCES `staff` (`id`) ON DELETE CASCADE;

ALTER TABLE consult_charges   
    ADD  `created_at` timestamp NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP after status;

ALTER TABLE `consult_charges`
    ADD FOREIGN KEY (`doctor`) REFERENCES `staff` (`id`) ON DELETE CASCADE;

ALTER TABLE contents
    DROP COLUMN `class_id`,
    DROP COLUMN `cls_sec_id`;

ALTER TABLE custom_fields
    ADD `visible_on_print` int(11) DEFAULT NULL after field_values,
    ADD `visible_on_report` int(11) DEFAULT NULL after visible_on_print,
    ADD `visible_on_patient_panel` int(11) DEFAULT NULL after visible_on_table,
    DROP COLUMN`show_table`;

Alter TABLE death_report
    ADD `patient_id` int(11) DEFAULT NULL after id ,
    ADD `case_reference_id` int(11) DEFAULT NULL after patient_id,
    ADD `attachment` varchar(200) NOT NULL after case_reference_id,
    ADD `attachment_name` text after attachment,
    MODIFY `is_active` varchar(10) NOT NULL,
    MODIFY   `death_report` text DEFAULT NULL,
    DROP COLUMN `opdipd_no`,
    DROP COLUMN `patient`,
    DROP COLUMN `gender`,
    DROP COLUMN `image`,
    DROP COLUMN  `contact`,
    DROP COLUMN `address`; 

ALTER TABLE `death_report`
    ADD FOREIGN KEY (`case_reference_id`) REFERENCES `case_references` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`) ON DELETE CASCADE;

Alter TABLE department
    ADD `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE email_config
    ADD COLUMN   `smtp_auth` varchar(10) NOT NULL after ssl_tls;

ALTER TABLE events
    ADD COLUMN   `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP after is_active;

ALTER TABLE expenses
    ADD COLUMN   `generated_by` int(11) DEFAULT NULL after is_deleted;

ALTER TABLE `expenses`
    ADD FOREIGN KEY (`exp_head_id`) REFERENCES `expense_head` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`generated_by`) REFERENCES `staff` (`id`) ON DELETE CASCADE;

ALTER TABLE floor
    MODIFY  `description` text DEFAULT NULL,
    ADD COLUMN   `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP after description;

ALTER TABLE general_calls
    MODIFY `note` mediumtext DEFAULT NULL,
    CHANGE  `call_dureation` `call_duration` varchar(50) NOT NULL,
    ADD COLUMN `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

ALTER TABLE income
    ADD COLUMN  `generated_by` int(11) DEFAULT NULL after documents;

ALTER TABLE ipd_prescription_details
    drop `ipd_id`,
    drop `medicine_category_id` ,
    drop `medicine`,
    MODIFY  `basic_id` int(11) DEFAULT NULL,
    MODIFY `dosage` int(11) DEFAULT NULL,
    ADD `pharmacy_id` int(10) DEFAULT NULL after basic_id,
    ADD  `dose_interval_id` int(11) DEFAULT NULL after dosage,
    ADD  `dose_duration_id` int(11) DEFAULT NULL after dose_interval_id,
    ADD `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP after instruction;

ALTER TABLE ipd_prescription_details
   MODIFY   `dosage` int(11) DEFAULT NULL,
   MODIFY `instruction` text DEFAULT NULL; 

ALTER TABLE `ipd_prescription_details`
    ADD FOREIGN KEY (`basic_id`) REFERENCES `ipd_prescription_basic` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacy` (`id`) ON DELETE CASCADE;

Alter TABLE item
    DROP COLUMN  `item_store_id`,
    DROP COLUMN `item_supplier_id`,
    MODIFY  `description` text DEFAULT NULL;

ALTER TABLE `item`
    ADD  FOREIGN KEY (`item_category_id`) REFERENCES `item_category` (`id`) ON DELETE CASCADE;

Alter TABLE item_store
    MODIFY   `description` text DEFAULT NULL,
    ADD `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE item_supplier
    MODIFY `description` text DEFAULT NULL,
    ADD `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE lab
    ADD `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE languages
    ADD `is_rtl` varchar(10) NOT NULL DEFAULT 'no' after is_deleted;

Alter TABLE medicine_batch_details
    ADD `tax` float(10,2) DEFAULT '0.00' after purchase_price, DROP COLUMN `medicine_category_id`, DROP COLUMN `expiry_date_format` ;

ALTER TABLE messages
    ADD `template_id` varchar(100) NOT NULL after title;

ALTER TABLE notification_setting
    MODIFY   `template` longtext DEFAULT NULL,
    MODIFY   `subject` text DEFAULT NULL,
    MODIFY `variables` text DEFAULT NULL,
    ADD `template_id` varchar(100) NOT NULL after template;

UPDATE `notification_setting` SET `variables` = '{{patient_name}} {{appointment_date}} {{patient_id}} {{opdno}}' WHERE `notification_setting`.`id` = 1;

UPDATE `notification_setting` SET `variables` = '{{patient_name}} {{patient_id}} {{ipd_no}}' WHERE `notification_setting`.`id` = 2;

UPDATE `notification_setting` SET `variables` = '{{patient_name}} {{currency_symbol}} {{total_amount}} {{paid_amount}} {balance_amount}}' WHERE `notification_setting`.`id` = 3;

UPDATE `notification_setting` SET `variables` = '{{display_name}} {{url}} {{username}} {{password}}' WHERE `notification_setting`.`id` = 5;

UPDATE `notification_setting` SET `variables` = '{{patient_name}} {{staff_name}} {{staff_surname}} {{date}} {{appointment_no}}' WHERE `notification_setting`.`id` = 6;

UPDATE `notification_setting` SET `variables` = '{{title}} {{date}} {{duration}}' WHERE `notification_setting`.`id` = 7;

UPDATE `notification_setting` SET `variables` = '{{display_name}}  {{email}}  {{resetpasslink}' WHERE `notification_setting`.`id` = 10;

DELETE FROM `notification_setting` WHERE `notification_setting`.`type` ='opd_patient_revisit';

ALTER TABLE medicine_category
    ADD  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE medicine_dosage
    DROP COLUMN  `dosage_form`,
    MODIFY `medicine_category_id` int(11) DEFAULT NULL,
    ADD  `charge_units_id` int(11) DEFAULT NULL after dosage,
    ADD `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP after charge_units_id;

ALTER TABLE `medicine_dosage`
    ADD FOREIGN KEY (`medicine_category_id`) REFERENCES `medicine_category` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`charge_units_id`) REFERENCES `charge_units` (`id`) ON DELETE CASCADE;

ALTER TABLE `chat_connections`
    ADD KEY `chat_user_one` (`chat_user_one`),
    ADD KEY `chat_user_two` (`chat_user_two`);

ALTER TABLE `chat_messages`
    ADD KEY `chat_user_id` (`chat_user_id`),
    ADD KEY `chat_connection_id` (`chat_connection_id`);

ALTER TABLE `chat_users`
    ADD KEY `staff_id` (`staff_id`),
    ADD KEY `patient_id` (`patient_id`),
    ADD KEY `create_staff_id` (`create_staff_id`),
    ADD KEY `create_patient_id` (`create_patient_id`);

ALTER TABLE operation_theatre
    ADD `opd_details_id` int(11) DEFAULT NULL after id,
    ADD `ipd_details_id` int(11) DEFAULT NULL after opd_details_id,
    ADD `operation_id` int(100) NOT NULL after customer_type,
    DROP COLUMN  `bill_no` ,
    DROP COLUMN  `patient_id`,
    DROP COLUMN `height`,
    DROP COLUMN `pulse`,
    DROP COLUMN `temperature`,
    DROP COLUMN `respiration`,
    DROP COLUMN `weight`,
    DROP COLUMN `bp`,
    DROP COLUMN `symptoms`,
    DROP COLUMN `apply_charge`,
    DROP COLUMN `charge_id`,
    DROP COLUMN `operation_name`,
    MODIFY `date` datetime DEFAULT NULL,
    MODIFY `consultant_doctor` int(11) DEFAULT NULL,
    MODIFY `generated_by` int(11) DEFAULT NULL after remark;

ALTER TABLE pathology
    MODIFY  `pathology_category_id` int(11) DEFAULT NULL,
    MODIFY  `charge_id` int(11) DEFAULT NULL, DROP COLUMN   `pathology_parameter_id`;

ALTER TABLE pathology_category
    ADD `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP after category_name;

ALTER TABLE patient_charges
    Drop COLUMN `patient_id`,
    ADD `opd_id` int(11) DEFAULT NULL after ipd_id,
    ADD `qty` int(11) DEFAULT NULL after opd_id,
    ADD `standard_charge` float(10,2) DEFAULT  '0.00' after qty,
    ADD `tpa_charge` float(10,2) DEFAULT  '0.00' after standard_charge,
    ADD `tax` float(10,2) DEFAULT '0.00' after tpa_charge,
    ADD `amount` float(10,2) DEFAULT '0.00' after apply_charge,
    ADD `note` text after amount,
    MODIFY   `charge_id` int(11) DEFAULT NULL after qty,
    MODIFY   `apply_charge` float(10,2) DEFAULT '0.00',
    MODIFY  `ipd_id` int(11) DEFAULT NULL,
    DROP COLUMN org_charge_id;

ALTER TABLE `patient_charges`
    ADD FOREIGN KEY (`opd_id`) REFERENCES `opd_details` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`ipd_id`) REFERENCES `ipd_details` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`charge_id`) REFERENCES `charges` (`id`) ON DELETE CASCADE;

ALTER TABLE payslip_allowance
    CHANGE payslip_id `staff_payslip_id` int(11) DEFAULT NULL,
    MODIFY `staff_id` int(11) DEFAULT NULL after staff_payslip_id,
    ADD  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP after cal_type;  

ALTER TABLE pharmacy
    MODIFY `medicine_category_id` int(11) DEFAULT NULL,
    MODIFY `note` text DEFAULT NULL,
    MODIFY   `vat` float DEFAULT NULL,
    MODIFY `is_active` varchar(10) NOT NULL,
    DROP COLUMN  `supplier`;

ALTER TABLE pharmacy_bill_basic
    MODIFY   `patient_id` int(11) DEFAULT NULL,
    MODIFY  `total` float(10,2) DEFAULT '0.00',
    MODIFY  `discount` float(10,2) DEFAULT '0.00',
    MODIFY `tax` float(10,2) DEFAULT '0.00',
    MODIFY `net_amount` float(10,2) DEFAULT '0.00',
    MODIFY `note` text DEFAULT NULL,
    MODIFY `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP after generated_by,
    MODIFY  `generated_by` int(11) DEFAULT NULL,
    ADD `ipd_prescription_basic_id` int(11) DEFAULT NULL after patient_id,
    ADD `case_reference_id` int(11) DEFAULT NULL after ipd_prescription_basic_id,
    ADD `discount_percentage` float(10,2) DEFAULT '0.00' after total,
    ADD `tax_percentage` float(10,2) DEFAULT '0.00' after discount,
    DROP COLUMN `opd_ipd_no`,
    DROP COLUMN  `bill_no`;

ALTER TABLE pharmacy_bill_detail
    ADD `medicine_batch_detail_id` int(11) DEFAULT NULL after pharmacy_bill_basic_id,
    ADD `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP after amount,
    MODIFY   `pharmacy_bill_basic_id` int(11) DEFAULT NULL,
    MODIFY   `sale_price` float(10,2) NOT NULL,
    MODIFY `amount` float(10,2) NOT NULL,
    DROP COLUMN `medicine_category_id`,
    DROP COLUMN `medicine_name` ,
    DROP COLUMN `expire_date` ,
    DROP COLUMN `batch_no`;

ALTER TABLE print_setting
    ADD `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP after is_active;

ALTER TABLE radio
    MODIFY  `radiology_category_id` int(11) DEFAULT NULL,
    MODIFY `charge_id` int(11) DEFAULT NULL,
    DROP COLUMN `radiology_parameter_id`;  

ALTER TABLE radiology_parameterdetails
    MODIFY  `radiology_id` int(11) DEFAULT NULL,
    ADD `radiology_parameter_id` int(11) DEFAULT NULL after radiology_id,
    drop  COLUMN `parameter_id`,
    DROP COLUMN `radiology_report_id`,
    Change `created_id` `created_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
    DROP COLUMN `radiology_report_value`; 

ALTER TABLE radiology_report
    DROP COLUMN `bill_no`,
    MODIFY  `radiology_id` int(11) DEFAULT NULL,
    MODIFY  `patient_id` int(11) DEFAULT NULL,
    ADD `radiology_bill_id` int(11) DEFAULT NULL after id,
    ADD `parameter_update` date DEFAULT NULL after reporting_date,
    ADD `report_name` text DEFAULT NULL after radiology_report,
    ADD `tax_percentage` float(10,2) NOT NULL DEFAULT '0.00' after report_name,
    ADD `radiology_center` varchar(250) NOT NULL after apply_charge, 
    ADD `collection_specialist` int(11) DEFAULT NULL after generated_by,
    ADD `collection_date` date DEFAULT NULL after collection_specialist,
    ADD `approved_by` int(11) DEFAULT NULL after collection_date,
    MODIFY  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP after approved_by,
    MODIFY `description` text,
    MODIFY `generated_by` int(11) DEFAULT NULL,
    MODIFY `apply_charge` float(10,2) NOT NULL DEFAULT 0.00,
    MODIFY `radiology_report` text;

ALTER TABLE `read_notification`
    DROP COLUMN `student_id` ,
    DROP COLUMN `parent_id` ,
    MODIFY `is_active` varchar(10) DEFAULT 'no',
    ADD FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE;

ALTER TABLE sch_settings
    MODIFY `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP after zoom_api_secret,
    ADD  `patient_panel` varchar(50) NOT NULL after superadmin_restriction;

ALTER TABLE source
    MODIFY   `description` mediumtext DEFAULT NULL,
    ADD `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP after description;

ALTER TABLE specialist
    ADD `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP after is_active;

ALTER TABLE staff
    drop  `department`,
    drop `designation`,
    MODIFY `employee_id` varchar(200) DEFAULT NULL,
    ADD `department_id` int(11) DEFAULT NULL,
    ADD `staff_designation_id` int(11) DEFAULT NULL,
    ADD `pan_number` varchar(30) NOT NULL after zoom_api_secret,
    ADD `identification_number` varchar(30) NOT NULL after pan_number,
    ADD `local_identification_number` varchar(30) NOT NULL after identification_number,
    ADD `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP after local_identification_number;

ALTER TABLE staff_designation
    MODIFY  `is_active` varchar(10) NOT NULL,
    ADD `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP after is_active;

ALTER TABLE staff_leave_details
    MODIFY   `staff_id` int(11) DEFAULT NULL,
    MODIFY `leave_type_id` int(11) DEFAULT NULL,
    ADD `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP after alloted_leave;

ALTER TABLE `staff_leave_details`
    ADD FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`leave_type_id`) REFERENCES `leave_types` (`id`) ON DELETE CASCADE;

ALTER TABLE staff_leave_request
    MODIFY   `staff_id` int(11) DEFAULT NULL,
    MODIFY `leave_type_id` int(11) DEFAULT NULL,
    MODIFY   `applied_by` int(11) DEFAULT NULL,
    ADD `status_updated_by` int(11) DEFAULT NULL after applied_by,
    ADD `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP after date;

ALTER TABLE `staff_leave_request`
    ADD FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`leave_type_id`) REFERENCES `leave_types` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`applied_by`) REFERENCES `staff` (`id`) ON DELETE CASCADE;

ALTER TABLE staff_payroll
    MODIFY `basic_salary` float(10,2) NOT NULL,
    MODIFY   `pay_scale` int(200) NOT NULL,
    ADD `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP after is_active;

ALTER TABLE staff_payslip
    MODIFY   `staff_id` int(11) DEFAULT NULL,
    MODIFY `basic` float(10,2) NOT NULL,
    MODIFY `total_allowance` float(10,2) NOT NULL,
    MODIFY `total_deduction` float(10,2) NOT NULL,
    MODIFY `tax` float(10,2) NOT NULL DEFAULT '0.00',
    MODIFY  `net_salary` float(10,2) NOT NULL,
    MODIFY   `remark` text DEFAULT NULL,
    ADD `cheque_no` varchar(250) DEFAULT NULL after year,
    ADD `cheque_date` date DEFAULT NULL after cheque_no,
    ADD `attachment` varchar(250) DEFAULT NULL after cheque_date,
    ADD `attachment_name` text after attachment,
    ADD `generated_by` int(11) DEFAULT NULL after remark,
    ADD `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP after generated_by;

ALTER TABLE `staff_payslip`
    ADD FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`generated_by`) REFERENCES `staff` (`id`) ON DELETE CASCADE;  

ALTER TABLE supplier_bill_basic
    DROP COLUMN `purchase_no`,
    DROP COLUMN `supplier_name`,
    MODIFY `date` datetime NOT NULL,
    MODIFY `total` float(10,2) NOT NULL,
    MODIFY `tax` float(10,2) NOT NULL,
    MODIFY `discount` float(10,2) NOT NULL,
    MODIFY `net_amount` float(10,2) NOT NULL,
    MODIFY `note` text DEFAULT NULL,
    MODIFY `supplier_id` int(11) DEFAULT NULL,
    ADD `payment_mode` varchar(30) DEFAULT NULL after note,
    ADD `cheque_no` varchar(255) DEFAULT NULL after payment_mode,
    ADD `cheque_date` date DEFAULT NULL after cheque_no,
    ADD `payment_date` datetime DEFAULT NULL after cheque_date,
    ADD `received_by` int(11) DEFAULT NULL after payment_date,
    ADD `attachment` varchar(255) DEFAULT NULL after received_by,
    ADD `attachment_name` varchar(255) DEFAULT NULL after attachment,
    ADD `payment_note` text after attachment_name;

TRUNCATE TABLE supplier_bill_basic;

ALTER TABLE `supplier_bill_basic`
    ADD FOREIGN KEY (`supplier_id`) REFERENCES `medicine_supplier` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`received_by`) REFERENCES `staff` (`id`) ON DELETE CASCADE;

ALTER TABLE system_notification
    MODIFY `notification_type` varchar(50) NOT NULL,
    MODIFY `notification_desc` text DEFAULT NULL,
    MODIFY `notification_for` varchar(50) NOT NULL,
    MODIFY   `receiver_id` int(11) DEFAULT NULL,
    MODIFY   `is_active` varchar(10) NOT NULL,
    ADD  `role_id` int(11) DEFAULT NULL after notification_for,
    ADD `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP after is_active;

ALTER TABLE visitors_book
    ADD `visit_to` varchar(20) NOT NULL after id_proof,
    ADD `ipd_opd_staff_id` int(11) DEFAULT NULL after visit_to,
    ADD `related_to` varchar(60) NOT NULL after ipd_opd_staff_id,
    MODIFY   `note` mediumtext DEFAULT NULL,
    ADD `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP after image;

ALTER TABLE visitors_purpose
    MODIFY  `description` mediumtext DEFAULT NULL,
    ADD `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP after description;

ALTER TABLE symptoms
    MODIFY   `description` text DEFAULT NULL;

ALTER TABLE visit_details 
    DROP COLUMN `patient_id` , 
    DROP COLUMN `opd_no` , 
    DROP COLUMN `opd_id` , 
    DROP COLUMN `amount` , 
    DROP COLUMN  `tax` ,
    DROP COLUMN `header_note` ,
    DROP COLUMN `footer_note` ,
    DROP COLUMN discharged,
    MODIFY `appointment_date` datetime DEFAULT NULL,
    MODIFY `symptoms` varchar(200) DEFAULT NULL,
    MODIFY `bp` varchar(100) DEFAULT NULL,
    MODIFY `height` varchar(100) DEFAULT NULL,
    MODIFY `weight` varchar(100) DEFAULT NULL,
    MODIFY `pulse` varchar(200) DEFAULT NULL,
    MODIFY `temperature` varchar(200) DEFAULT NULL,
    MODIFY `respiration` varchar(200) DEFAULT NULL,
    MODIFY `known_allergies` varchar(100) DEFAULT NULL,
    MODIFY `casualty` varchar(200) DEFAULT NULL,
    MODIFY `refference` varchar(200) DEFAULT NULL,
    MODIFY `date` date DEFAULT NULL,
    MODIFY `note` text DEFAULT NULL,
    MODIFY `note_remark` mediumtext DEFAULT NULL,
    MODIFY `generated_by` int(11) DEFAULT NULL,
    MODIFY `cons_doctor` int(11) DEFAULT NULL,
    ADD `opd_details_id` int(11) DEFAULT NULL after id, 
    ADD `organisation_id` int(11) DEFAULT NULL after opd_details_id,
    ADD `patient_charge_id` int(11) DEFAULT NULL after organisation_id,
    ADD `transaction_id` int(11) DEFAULT NULL after patient_charge_id,
    ADD `symptoms_type` int(11) DEFAULT NULL after appointment_date,
    ADD `patient_old` varchar(50) DEFAULT NULL after known_allergies,
    ADD `can_delete` varchar(11) NOT NULL DEFAULT 'yes' after live_consult,
    ADD `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP after can_delete;

ALTER TABLE `visit_details`
    ADD FOREIGN KEY (`generated_by`) REFERENCES `staff` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`opd_details_id`) REFERENCES `opd_details` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`organisation_id`) REFERENCES `organisation` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`cons_doctor`) REFERENCES `staff` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`patient_charge_id`) REFERENCES `patient_charges` (`id`) ON DELETE SET NULL,
    ADD FOREIGN KEY (`transaction_id`) REFERENCES `transactions` (`id`) ON DELETE SET NULL;

ALTER TABLE `conferences_history`
    ADD FOREIGN KEY (`conference_id`) REFERENCES `conferences` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`) ON DELETE CASCADE;

ALTER TABLE `conference_staff`
    ADD FOREIGN KEY (`conference_id`) REFERENCES `conferences` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE;

ALTER TABLE `custom_field_values`
    ADD FOREIGN KEY (`custom_field_id`) REFERENCES `custom_fields` (`id`) ON DELETE CASCADE;

ALTER TABLE ipd_prescription_basic
    MODIFY `ipd_id` int(11) DEFAULT NULL,
    ADD `visit_details_id` int(11) DEFAULT NULL,
    ADD `finding_description` text DEFAULT NULL,
    ADD `is_finding_print` varchar(100) DEFAULT NULL,  
    ADD `generated_by` int(11) DEFAULT NULL,
    ADD `prescribe_by` int(11) DEFAULT NULL,
    ADD `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    MODIFY `header_note` text DEFAULT NULL after visit_details_id,
    MODIFY `footer_note` text DEFAULT NULL after header_note,
    MODIFY `date` date NOT NULL after is_finding_print;

ALTER TABLE leave_types
    ADD `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP after is_active;

ALTER TABLE medicine_bad_stock
    MODIFY `expiry_date` date NOT NULL,
    MODIFY `batch_no` varchar(100) NOT NULL,
    MODIFY `quantity` varchar(20) NOT NULL,
    MODIFY `note` text DEFAULT NULL,
    MODIFY `pharmacy_id` int(11) DEFAULT NULL,
    ADD `medicine_batch_details_id` int(11) DEFAULT NULL after id, 
    ADD `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP after note;

ALTER TABLE opd_details
    MODIFY `patient_id` int(11) DEFAULT NULL,
    ADD  `case_reference_id` int(11) DEFAULT NULL after id,
    ADD `is_ipd_moved` int(11) NOT NULL DEFAULT '0' after generated_by,
    ADD `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP after discharged,
    DROP COLUMN `live_consult`,
    DROP COLUMN `opd_no`,
    DROP COLUMN `appointment_date`,
    DROP COLUMN `case_type`,
    DROP COLUMN `casualty`,
    DROP COLUMN `symptoms`,
    DROP COLUMN `bp`,
    DROP COLUMN `height`,
    DROP COLUMN `weight`,
    DROP COLUMN `pulse`,
    DROP COLUMN `temperature`,
    DROP COLUMN `respiration`,
    DROP COLUMN `known_allergies`,
    DROP COLUMN `note_remark`,
    DROP COLUMN `refference`,
    DROP COLUMN `cons_doctor`,
    DROP COLUMN `amount`,
    DROP COLUMN `tax`,
    DROP COLUMN `payment_mode`,
    DROP COLUMN `header_note`,
    DROP COLUMN `footer_note`,
    MODIFY  `generated_by` int(11) DEFAULT NULL,
    MODIFY  `discharged` varchar(10) NOT NULL DEFAULT 'no';

ALTER TABLE organisations_charges
    DROP COLUMN `charge_type`,
    MODIFY  `org_id` int(11) DEFAULT NULL,
    MODIFY `charge_id` int(11) DEFAULT NULL,
    MODIFY `org_charge` float(10,2) NOT NULL,
    ADD `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP after org_charge;

ALTER TABLE pathology_parameterdetails
    MODIFY  `pathology_id` int(11) DEFAULT NULL,
 
ADD `pathology_parameter_id` int(11) DEFAULT NULL after pathology_id,
    DROP COLUMN  `parameter_id`,
    DROP COLUMN  `pathology_report_id`,
    DROP COLUMN `pathology_report_value`;

ALTER TABLE patient_timeline
    MODIFY `patient_id` int(11) DEFAULT NULL,
    MODIFY  `description` text DEFAULT NULL,
    MODIFY  `timeline_date` date DEFAULT NULL,
    ADD `generated_users_type` varchar(100) NOT NULL after date,
    ADD `generated_users_id` int(11) DEFAULT NULL after generated_users_type,
    ADD `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP after generated_users_id;

ALTER TABLE radiology_report_parameterdetails
    MODIFY `radiology_report_id` int(11) DEFAULT NULL,
    ADD  `radiology_parameterdetail_id` int(11) DEFAULT NULL after radiology_report_id,
    ADD `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP after radiology_report_value, DROP COLUMN parameter_id;

ALTER TABLE ambulance_call
    MODIFY `contact_no` varchar(20) DEFAULT NULL,
    MODIFY `address` text,
    MODIFY `date` datetime DEFAULT NULL,
    MODIFY `amount` float(10,2) DEFAULT '0.00' after tax_percentage,
    MODIFY `net_amount` float(10,2) DEFAULT NULL after amount,
    MODIFY `transaction_id` int(11) DEFAULT NULL after net_amount,
    MODIFY `note` text DEFAULT NULL after transaction_id,
    MODIFY `generated_by` int(11) DEFAULT NULL after note,
    MODIFY `created_at` timestamp NULL DEFAULT current_timestamp() after generated_by;

Alter TABLE appointment
    MODIFY `patient_id` int(11) DEFAULT NULL,
    MODIFY `doctor` int(11) DEFAULT NULL,
    MODIFY `message` text;

Alter TABLE bed
    MODIFY `bed_group_id` int(11) NOT NULL,
    MODIFY `is_active` varchar(10) NOT NULL;

Alter TABLE bed_group
    MODIFY `floor` int(11) NOT NULL;

Alter TABLE birth_report
    MODIFY `birth_date` datetime DEFAULT NULL,
    MODIFY `contact` varchar(20) NOT NULL,
    MODIFY `address` text DEFAULT NULL,
    MODIFY `is_active` varchar(10) NOT NULL,
    MODIFY `patient_id` int(11) DEFAULT NULL,
    MODIFY `birth_report` mediumtext DEFAULT NULL;

ALTER TABLE blood_donor
    MODIFY `address` text;

Alter TABLE blood_issue 
    MODIFY `discount_percentage` float(10,2) DEFAULT '0.00',
    MODIFY  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP after generated_by,
    MODIFY `remark` mediumtext,
    MODIFY `amount` decimal(15,2) DEFAULT NULL after discount_percentage,
    MODIFY `net_amount` float(10,2) NOT NULL after amount;

ALTER TABLE charges
    MODIFY   `standard_charge` float(10,2) DEFAULT '0.00' after name,
    MODIFY `date` date DEFAULT NULL after standard_charge;

ALTER TABLE charge_categories
    MODIFY `description` mediumtext DEFAULT NULL,
    MODIFY `is_default` varchar(10) NOT NULL after short_code;

ALTER TABLE complaint   
    MODIFY  `contact` varchar(20) NOT NULL,
    MODIFY `date` date DEFAULT NULL;

ALTER TABLE conferences
     MODIFY `purpose` varchar(200) NOT NULL,
     MODIFY `patient_id` int(11) DEFAULT NULL,
     MODIFY `ipd_id` int(11) DEFAULT NULL,
     MODIFY `title` text DEFAULT NULL,
     MODIFY `password` varchar(100) NOT NULL,
     MODIFY `description` mediumtext DEFAULT NULL,
     MODIFY `timezone` text DEFAULT NULL;

ALTER TABLE conferences_history
    MODIFY `conference_id` int(11) DEFAULT NULL,
    MODIFY  `staff_id` int(11) DEFAULT NULL;

ALTER TABLE conference_staff
    MODIFY   `conference_id` int(11) DEFAULT NULL,
    MODIFY `staff_id` int(11) DEFAULT NULL,
    MODIFY  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP after staff_id;

ALTER TABLE consultant_register
    MODIFY   `ipd_id` int(11) DEFAULT NULL,
    MODIFY   `cons_doctor` int(11) DEFAULT NULL,
    MODIFY  `date` datetime DEFAULT NULL,
    MODIFY `ins_date` date DEFAULT NULL,
    MODIFY `instruction` text DEFAULT NULL;

ALTER TABLE consult_charges
    MODIFY   `doctor` int(11) DEFAULT NULL,
    MODIFY `standard_charge` float(10,2) NOT NULL,
    MODIFY `status` varchar(10) NOT NULL;

ALTER TABLE contents
    MODIFY `note` text after file,
    MODIFY `date` date DEFAULT NULL after note,
    MODIFY `is_active` varchar(10) DEFAULT 'no' after date,
    MODIFY `created_by` int(11) DEFAULT NULL after is_active;

ALTER TABLE custom_fields
    MODIFY  `visible_on_table` int(11) DEFAULT NULL;

ALTER TABLE radiology_parameter
    MODIFY  `description` text DEFAULT NULL;

ALTER TABLE department
    MODIFY `is_active` varchar(10) NOT NULL;
 
ALTER TABLE front_cms_menu_items
    MODIFY `menu_id` int(11) DEFAULT NULL;

ALTER TABLE dispatch_receive
    MODIFY `address` text DEFAULT NULL,
    MODIFY `note` text DEFAULT NULL,
    MODIFY `date` date NOT NULL,
    MODIFY `type` varchar(10) NOT NULL after image;

ALTER TABLE events
    MODIFY   `role_id` int(11) DEFAULT NULL,
    MODIFY `event_description` text DEFAULT NULL,
    MODIFY `is_active` varchar(10) NOT NULL;

ALTER TABLE expenses
    MODIFY   `amount` float(10,2) DEFAULT NULL,
    MODIFY `note` text DEFAULT NULL,
    MODIFY `is_active` varchar(10) DEFAULT 'yes',
    MODIFY `is_deleted` varchar(10) DEFAULT 'no';

ALTER TABLE expense_head
    MODIFY `is_active` varchar(10) DEFAULT 'yes',
    MODIFY `is_deleted` varchar(10) DEFAULT 'no';

ALTER TABLE front_cms_program_photos
    MODIFY   `media_gallery_id` int(11) DEFAULT NULL;

ALTER TABLE front_cms_menus
    MODIFY `ext_url` mediumtext DEFAULT NULL,
    MODIFY `ext_url_link` mediumtext DEFAULT NULL;

ALTER TABLE front_cms_media_gallery
    MODIFY   `vid_url` mediumtext DEFAULT NULL,
    MODIFY `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP after vid_title;

ALTER TABLE front_cms_programs
    MODIFY `meta_title` mediumtext DEFAULT NULL,
    MODIFY `meta_description` mediumtext DEFAULT NULL,
    MODIFY `meta_keyword` mediumtext DEFAULT NULL,
    MODIFY `feature_image` mediumtext DEFAULT NULL,
    MODIFY `publish_date` date DEFAULT NULL,
    MODIFY `publish` varchar(10) NOT NULL DEFAULT '0',
    MODIFY `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP after sidebar;

ALTER TABLE general_calls
    MODIFY  `description` text DEFAULT NULL,
    MODIFY `follow_up_date` date DEFAULT NULL;

ALTER TABLE income
    MODIFY `inc_head_id` int(11) DEFAULT NULL,
    MODIFY`amount` float(10,2) DEFAULT '0.00',
    MODIFY `is_deleted` varchar(10) DEFAULT 'no',
    MODIFY `documents` varchar(255) DEFAULT NULL after is_deleted,
    MODIFY `generated_by` int(11) DEFAULT NULL after documents,
    MODIFY  `is_active` varchar(10) DEFAULT 'yes' after generated_by;

ALTER TABLE income_head
    MODIFY `description` text,
    MODIFY `is_active` varchar(10) NOT NULL DEFAULT 'yes',
    MODIFY `is_deleted` varchar(10) NOT NULL DEFAULT 'no';

ALTER TABLE item
     MODIFY `date` date DEFAULT NULL,
     MODIFY `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP after date;

ALTER TABLE item_category
    MODIFY   `item_category` varchar(255) DEFAULT NULL,
    MODIFY `is_active` varchar(10) NOT NULL DEFAULT 'yes',
    MODIFY `description` text DEFAULT NULL;

ALTER TABLE item_issue
    MODIFY  `note` text DEFAULT NULL,
    MODIFY `issue_type` int(11) DEFAULT NULL,
    MODIFY `issue_to` int(11) DEFAULT NULL,
    MODIFY `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP after is_active;

ALTER TABLE item_stock
    MODIFY   `description` text DEFAULT NULL,
    MODIFY `purchase_price` float(10,2) DEFAULT '0.00',
    MODIFY `date` date DEFAULT NULL;

ALTER TABLE medicine_batch_details
    MODIFY  `supplier_bill_basic_id` int(11) DEFAULT NULL,
    CHANGE  `expiry_date`  `expiry` date NOT NULL,
    MODIFY  `pharmacy_id` int(100) DEFAULT NULL,
    MODIFY `mrp` float(10,2) DEFAULT '0.00',
    MODIFY `purchase_price` float(10,2) DEFAULT '0.00',
    MODIFY `sale_rate` float(10,2) DEFAULT '0.00',
    MODIFY `batch_amount` float(10,2) DEFAULT '0.00',
    MODIFY `amount` float(10,2) DEFAULT '0.00',
    MODIFY `available_quantity` int(10) DEFAULT NULL;

ALTER TABLE pathology_parameter
    MODIFY  `description` text DEFAULT NULL,
    MODIFY  `parameter_name` varchar(100) NOT NULL,
    MODIFY `test_value` varchar(100) NOT NULL,
    MODIFY `reference_range` varchar(100) NOT NULL,
    MODIFY `unit` int(11) DEFAULT NULL;

ALTER TABLE patient_charges
    MODIFY  `date` datetime DEFAULT NULL;

ALTER TABLE read_systemnotification
    MODIFY `notification_id` int(11) DEFAULT NULL,
    MODIFY `receiver_id` int(11) DEFAULT NULL,
    MODIFY   `is_active` varchar(10) NOT NULL;

ALTER TABLE staff
    MODIFY `department_id` int(11) DEFAULT NULL after lang_id,
    MODIFY `staff_designation_id` int(11) DEFAULT NULL after department_id,
    MODIFY `dob` date DEFAULT NULL,
    MODIFY `date_of_joining` date DEFAULT NULL,
    MODIFY `date_of_leaving` date DEFAULT NULL;

ALTER TABLE staff_timeline
    MODIFY  `staff_id` int(11) DEFAULT NULL,
    MODIFY `description` text DEFAULT NULL,
    MODIFY `status` varchar(10) NOT NULL;

ALTER TABLE users_authentication
    MODIFY   `users_id` int(11) DEFAULT NULL;

ALTER TABLE users
    MODIFY `user_id` int(10) DEFAULT NULL,
    MODIFY `childs` text DEFAULT NULL,
    MODIFY  `is_active` varchar(10) DEFAULT 'yes';

ALTER TABLE front_cms_pages
    MODIFY `publish_date` date DEFAULT NULL;

ALTER TABLE organisation
    ADD  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    MODIFY `contact_no` varchar(20) NOT NULL,
    MODIFY `contact_person_phone` varchar(20) NOT NULL;

ALTER TABLE send_notification
    MODIFY   `is_active` varchar(10) DEFAULT 'no';

ALTER TABLE sms_config
    MODIFY   `is_active` varchar(10) DEFAULT 'disabled';

ALTER TABLE blood_donor_cycle
    MODIFY  `donate_date` date DEFAULT NULL after charge_id,
    MODIFY  `bag_no` varchar(11) DEFAULT NULL after donate_date,
    MODIFY `lot` varchar(11) DEFAULT NULL after bag_no,
    MODIFY `quantity` int(11) DEFAULT NULL after lot,
    MODIFY `standard_charge` float(10,2) DEFAULT NULL AFTER quantity,
    MODIFY `apply_charge` float(10,2) DEFAULT NULL AFTER standard_charge,
    MODIFY `amount` float(10,2) DEFAULT NULL AFTER apply_charge,
    MODIFY `note` text after institution, 
    ADD `volume` varchar(100) DEFAULT NULL after tax_percentage,
    ADD `unit` int(11) DEFAULT NULL after volume,
    ADD `available` int(1) NOT NULL DEFAULT '1' after unit;

ALTER TABLE ipd_details
    DROP COLUMN `ipd_no`,
    DROP COLUMN `room`,
    DROP COLUMN amount,
    DROP COLUMN tax,
    DROP COLUMN discharged_date,
    ADD  `case_reference_id` int(11) DEFAULT NULL after patient_id,
    ADD  `patient_old` varchar(50) NOT NULL after known_allergies,
    ADD `generated_by` int(11) DEFAULT NULL after live_consult,
    ADD  `organisation_id` int(11) DEFAULT NULL after cons_doctor,
    MODIFY  `date` datetime DEFAULT NULL,
    MODIFY   `known_allergies` varchar(200) DEFAULT NULL,
    MODIFY `patient_id` int(11) DEFAULT NULL, 
    MODIFY   `bed_group_id` int(10) DEFAULT NULL,
    MODIFY  `note` text DEFAULT NULL,
    MODIFY   `cons_doctor` int(11) DEFAULT NULL,
    ADD `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP after generated_by;

ALTER TABLE pathology_billing
    MODIFY `note` text DEFAULT NULL;

ALTER TABLE pathology_report
    ADD  `pathology_bill_id` int(11) DEFAULT NULL after id,
    DROP COLUMN bill_no,
    DROP COLUMN generated_by,
    MODIFY  `pathology_id` int(11) DEFAULT NULL,
    MODIFY   `patient_id` int(11) DEFAULT NULL after customer_type,
    MODIFY `reporting_date` date DEFAULT NULL after patient_id,
    ADD `parameter_update` date DEFAULT NULL after reporting_date,
    ADD `tax_percentage` float(10,2) NOT NULL DEFAULT '0.00' after parameter_update,
    MODIFY `apply_charge` float(10,2) NOT NULL after tax_percentage,
    ADD `collection_date` date DEFAULT NULL after apply_charge,
    ADD `collection_specialist` int(100) DEFAULT NULL after collection_date,
    ADD `pathology_center` varchar(250) DEFAULT NULL after collection_specialist,
    ADD `approved_by` int(11) DEFAULT NULL after pathology_center,
    ADD `report_name` text  DEFAULT NULL after pathology_report,
    MODIFY  `description` text,
    Drop COLUMN `consultant_doctor`;

ALTER TABLE pathology_report_parameterdetails
    DROP COLUMN parameter_id,
    MODIFY   `pathology_report_id` int(11) DEFAULT NULL,
    ADD `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP after pathology_report_value,
    ADD `pathology_parameterdetail_id` int(11) DEFAULT NULL after pathology_report_id;

ALTER TABLE patients
    MODIFY  `age` int(10) NOT NULL,
    MODIFY `month` int(10) NOT NULL,
    MODIFY   `lang_id` int(11) DEFAULT NULL,
    ADD `day` int(11) NOT NULL after month,
    MODIFY `dob` date DEFAULT NULL after patient_name,
    ADD `blood_bank_product_id` int(11) DEFAULT NULL after blood_group,
    ADD `identification_number` varchar(60) NOT NULL after patient_type,
    ADD `insurance_id` varchar(250) DEFAULT NULL after app_key,
    ADD `insurance_validity` date DEFAULT NULL after insurance_id,
    ADD `is_dead` varchar(255) NOT NULL DEFAULT 'no' after insurance_validity,
    MODIFY `is_active` varchar(255) DEFAULT 'no' after is_dead,
    DROP COLUMN`guardian_phone`,
    DROP COLUMN`guardian_address`,
    DROP COLUMN`guardian_email`,
    DROP COLUMN `old_patient`,
    DROP COLUMN `credit_limit`,
    DROP COLUMN `organisation`,
    DROP COLUMN patient_unique_id,
    DROP COLUMN admission_date,
    DROP COLUMN discharged,
    MODIFY `address` text DEFAULT NULL,
    MODIFY   `disable_at` date DEFAULT NULL after is_active,
    MODIFY  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP after disable_at;

ALTER TABLE staff_attendance
    MODIFY   `staff_id` int(11) DEFAULT NULL,
    MODIFY `staff_attendance_type_id` int(11) DEFAULT NULL,
    MODIFY `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
    MODIFY `updated_at` datetime DEFAULT NULL;

ALTER TABLE `vehicles` CHANGE `id` `id` INT(10) NOT NULL AUTO_INCREMENT;

ALTER TABLE `appointment`
    ADD FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`doctor`) REFERENCES `staff` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`case_reference_id`) REFERENCES `case_references` (`id`) ON DELETE CASCADE;

ALTER TABLE `blood_donor_cycle`
    ADD FOREIGN KEY (`blood_bank_product_id`) REFERENCES `blood_bank_products` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`blood_donor_id`) REFERENCES `blood_donor` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`charge_id`) REFERENCES `charges` (`id`) ON DELETE CASCADE;

ALTER TABLE `income`
    ADD FOREIGN KEY (`inc_head_id`) REFERENCES `income_head` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`generated_by`) REFERENCES `staff` (`id`) ON DELETE CASCADE;

ALTER TABLE `ipd_details`
    ADD FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`case_reference_id`) REFERENCES `case_references` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`case_reference_id`) REFERENCES `case_references` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`cons_doctor`) REFERENCES `staff` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`bed_group_id`) REFERENCES `bed_group` (`id`) ON DELETE CASCADE;

ALTER TABLE `ipd_prescription_basic`
    ADD FOREIGN KEY (`ipd_id`) REFERENCES `ipd_details` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`visit_details_id`) REFERENCES `visit_details` (`id`) ON DELETE CASCADE;

ALTER TABLE `item_issue`
    ADD FOREIGN KEY (`issue_to`) REFERENCES `staff` (`id`) ON DELETE CASCADE;

ALTER TABLE `medicine_bad_stock`
    ADD FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacy` (`id`) ON DELETE CASCADE;

ALTER TABLE `medicine_batch_details`
    ADD FOREIGN KEY (`supplier_bill_basic_id`) REFERENCES `supplier_bill_basic` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`pharmacy_id`) REFERENCES `pharmacy` (`id`) ON DELETE CASCADE;

ALTER TABLE `opd_details`
    ADD FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`case_reference_id`) REFERENCES `case_references` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`generated_by`) REFERENCES `staff` (`id`) ON DELETE CASCADE;

ALTER TABLE `operation_theatre`
    ADD FOREIGN KEY (`opd_details_id`) REFERENCES `opd_details` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`ipd_details_id`) REFERENCES `ipd_details` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`consultant_doctor`) REFERENCES `staff` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`generated_by`) REFERENCES `staff` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`operation_id`) REFERENCES `operation` (`id`) ON DELETE CASCADE;

ALTER TABLE `organisations_charges`
    ADD FOREIGN KEY (`org_id`) REFERENCES `organisation` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`charge_id`) REFERENCES `charges` (`id`) ON DELETE CASCADE;

ALTER TABLE `pathology_parameter`
    ADD FOREIGN KEY (`unit`) REFERENCES `unit` (`id`) ON DELETE CASCADE;

ALTER TABLE `pathology_parameterdetails`
    ADD FOREIGN KEY (`pathology_id`) REFERENCES `pathology` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`pathology_parameter_id`) REFERENCES `pathology_parameter` (`id`) ON DELETE CASCADE;

ALTER TABLE `pathology_report`
    ADD FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`pathology_bill_id`) REFERENCES `pathology_billing` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`pathology_id`) REFERENCES `pathology` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`collection_specialist`) REFERENCES `staff` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`approved_by`) REFERENCES `staff` (`id`) ON DELETE CASCADE;

ALTER TABLE `pathology_report_parameterdetails`
    ADD FOREIGN KEY (`pathology_report_id`) REFERENCES `pathology_report` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`pathology_parameterdetail_id`) REFERENCES `pathology_parameterdetails` (`id`) ON DELETE CASCADE;

ALTER TABLE `patients`
    ADD FOREIGN KEY (`blood_bank_product_id`) REFERENCES `blood_bank_products` (`id`) ON DELETE CASCADE;

ALTER TABLE `patient_bed_history`
    ADD FOREIGN KEY (`case_reference_id`) REFERENCES `case_references` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`bed_group_id`) REFERENCES `bed_group` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`bed_id`) REFERENCES `bed` (`id`) ON DELETE CASCADE;

ALTER TABLE `patient_timeline`
    ADD FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`) ON DELETE CASCADE;

ALTER TABLE `payslip_allowance`
    ADD FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`staff_payslip_id`) REFERENCES `staff_payslip` (`id`) ON DELETE CASCADE;

ALTER TABLE `pharmacy`
    ADD FOREIGN KEY (`medicine_category_id`) REFERENCES `medicine_category` (`id`) ON DELETE CASCADE;

ALTER TABLE `pharmacy_bill_basic`
    ADD FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`case_reference_id`) REFERENCES `case_references` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`generated_by`) REFERENCES `staff` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`ipd_prescription_basic_id`) REFERENCES `ipd_prescription_basic` (`id`) ON DELETE CASCADE;

ALTER TABLE `pharmacy_bill_detail`
    ADD FOREIGN KEY (`pharmacy_bill_basic_id`) REFERENCES `pharmacy_bill_basic` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`medicine_batch_detail_id`) REFERENCES `medicine_batch_details` (`id`) ON DELETE CASCADE;

ALTER TABLE `radiology_parameterdetails`
    ADD FOREIGN KEY (`radiology_id`) REFERENCES `radio` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`radiology_parameter_id`) REFERENCES `radiology_parameter` (`id`) ON DELETE CASCADE;

ALTER TABLE `radiology_report`
    ADD FOREIGN KEY (`radiology_id`) REFERENCES `radio` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`radiology_bill_id`) REFERENCES `radiology_billing` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`generated_by`) REFERENCES `staff` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`collection_specialist`) REFERENCES `staff` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`approved_by`) REFERENCES `staff` (`id`) ON DELETE CASCADE;

ALTER TABLE `radiology_report_parameterdetails`
    ADD FOREIGN KEY (`radiology_report_id`) REFERENCES `radiology_report` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`radiology_parameterdetail_id`) REFERENCES `radiology_parameterdetails` (`id`) ON DELETE CASCADE;

ALTER TABLE `read_systemnotification`
    ADD FOREIGN KEY (`notification_id`) REFERENCES `system_notification` (`id`) ON DELETE CASCADE;

ALTER TABLE `send_notification`
    ADD FOREIGN KEY (`created_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE;

ALTER TABLE `staff_attendance`
    ADD FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`staff_attendance_type_id`) REFERENCES `staff_attendance_type` (`id`) ON DELETE CASCADE;

ALTER TABLE `staff_roles`
    ADD FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE;

ALTER TABLE `staff_timeline`
    ADD  FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE;

ALTER TABLE `ambulance_call`
    ADD FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`) ON DELETE CASCADE,  
    ADD FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`generated_by`) REFERENCES `staff` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`case_reference_id`) REFERENCES `case_references` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`transaction_id`) REFERENCES `transactions` (`id`) ON DELETE SET NULL;

ALTER TABLE `operation`
    ADD FOREIGN KEY (`category_id`) REFERENCES `operation_category` (`id`) ON DELETE CASCADE;

ALTER TABLE `blood_donor`
    ADD CONSTRAINT FOREIGN KEY (`blood_bank_product_id`) REFERENCES `blood_bank_products` (`id`) ON DELETE CASCADE;

ALTER TABLE transactions
    ADD FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`case_reference_id`) REFERENCES `case_references` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`opd_id`) REFERENCES `opd_details` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`ipd_id`) REFERENCES `ipd_details` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`pharmacy_bill_basic_id`) REFERENCES `pharmacy_bill_basic` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`pathology_billing_id`) REFERENCES `pathology_billing` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`radiology_billing_id`) REFERENCES `radiology_billing` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`blood_donor_cycle_id`) REFERENCES `blood_donor_cycle` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`blood_issue_id`) REFERENCES `blood_issue` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`ambulance_call_id`) REFERENCES `ambulance_call` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`appointment_id`) REFERENCES `appointment` (`id`) ON DELETE CASCADE ;   

ALTER TABLE `chat_connections`
    ADD FOREIGN KEY (`chat_user_one`) REFERENCES `chat_users` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`chat_user_two`) REFERENCES `chat_users` (`id`) ON DELETE CASCADE;

ALTER TABLE `chat_messages`
    ADD FOREIGN KEY (`chat_user_id`) REFERENCES `chat_users` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`chat_connection_id`) REFERENCES `chat_connections` (`id`) ON DELETE CASCADE;

ALTER TABLE `chat_users`
    ADD FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`create_staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`create_patient_id`) REFERENCES `patients` (`id`) ON DELETE CASCADE;

ALTER TABLE `radio`
    ADD FOREIGN KEY (`charge_id`) REFERENCES `charges` (`id`) ON DELETE CASCADE;
    ALTER TABLE `pathology`
    ADD FOREIGN KEY (`pathology_category_id`) REFERENCES `pathology_category` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`charge_id`) REFERENCES `charges` (`id`) ON DELETE CASCADE;
  
Alter TABLE bed
    ADD `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    MODIFY `bed_type_id` int(11) DEFAULT NULL,
    MODIFY `bed_group_id` int(11) DEFAULT NULL;

ALTER TABLE `bed`
    ADD FOREIGN KEY (`bed_type_id`) REFERENCES `bed_type` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`bed_group_id`) REFERENCES `bed_group` (`id`) ON DELETE CASCADE;

ALTER TABLE blood_issue
    MODIFY `amount` float(10,2) DEFAULT NULL;

ALTER TABLE complaint
    MODIFY  `description` text DEFAULT NULL;

ALTER TABLE front_cms_settings
    ADD `is_active_online_appointment` int(11) DEFAULT NULL after is_active_front_cms,
    MODIFY   `sidebar_options` mediumtext DEFAULT NULL;

ALTER TABLE `sch_settings`
    MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

ALTER TABLE `conferences`
    ADD FOREIGN KEY (`staff_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`patient_id`) REFERENCES `patients` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`visit_details_id`) REFERENCES `visit_details` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`ipd_id`) REFERENCES `ipd_details` (`id`) ON DELETE CASCADE,
    ADD FOREIGN KEY (`created_id`) REFERENCES `staff` (`id`) ON DELETE CASCADE;

INSERT INTO `charge_type_master` (`id`, `charge_type`, `is_default`, `is_active`, `created_at`) VALUES
(1, 'Appointment', 'yes', 'yes', '2021-09-24 14:10:32'),
(2, 'OPD', 'yes', 'yes', '2021-09-24 14:10:02'),
(3, 'IPD', 'yes', 'yes', '2021-09-24 14:10:47'),
(4, 'Pathology', 'yes', 'yes', '2021-10-22 21:40:03'),
(5, 'Radiology', 'yes', 'yes', '2021-10-22 22:10:21'),
(6, 'Blood Bank', 'yes', 'yes', '2021-10-22 22:10:33'),
(7, 'Ambulance', 'yes', 'yes', '2021-10-22 22:10:44'),
(8, 'Procedures', 'yes', 'yes', '2018-08-17 13:40:07'),
(9, 'Investigations', 'yes', 'yes', '2018-08-17 13:40:07'),
(10, 'Supplier', 'yes', 'yes', '2018-08-17 13:40:07'),
(11, 'Operations', 'yes', 'yes', '2018-08-17 13:40:07'),
(12, 'Others', 'yes', 'yes', '2018-08-17 13:40:07');

INSERT INTO `charge_type_module` (`id`, `charge_type_master_id`, `module_shortcode`, `created_at`) VALUES
(2, 1, 'appointment', '2021-10-23 03:52:42'),
(4, 2, 'opd', '2021-10-23 03:52:45'),
(5, 3, 'ipd', '2021-10-23 03:52:49'),
(6, 4, 'pathology', '2021-10-23 03:52:52'),
(7, 5, 'radiology', '2021-10-23 03:52:54'),
(8, 6, 'blood_bank', '2021-10-23 03:52:56'),
(9, 7, 'ambulance', '2021-10-23 03:52:59'),
(10, 8, 'opd', '2021-10-23 03:53:03'),
(11, 8, 'ipd', '2021-10-23 03:53:04'),
(13, 9, 'pathology', '2021-10-23 03:53:09'),
(14, 9, 'radiology', '2021-10-23 03:53:11'),
(15, 10, 'opd', '2021-10-23 03:53:14'),
(16, 10, 'ipd', '2021-10-23 03:53:16'),
(17, 11, 'opd', '2021-10-23 03:53:18'),
(18, 11, 'ipd', '2021-10-23 03:53:18'),
(19, 12, 'appointment', '2021-10-23 03:53:20'),
(20, 12, 'opd', '2021-10-23 03:53:21'),
(21, 12, 'ipd', '2021-10-23 03:53:21'),
(24, 12, 'pathology', '2021-10-23 03:53:25'),
(25, 12, 'radiology', '2021-10-23 03:53:27'),
(26, 12, 'blood_bank', '2021-10-23 03:53:30'),
(27, 12, 'ambulance', '2021-10-23 03:53:31');

INSERT INTO `captcha` (`id`, `name`, `status`, `created_at`) VALUES
(1, 'userlogin', 0, '2021-10-20 08:48:05'),
(2, 'login', 0, '2021-10-20 08:48:07'),
(3, 'appointment', 0, '2021-10-20 08:48:10');

INSERT INTO `prefixes` (`id`, `type`, `prefix`, `created_at`) VALUES
(1, 'ipd_no', 'IPDN', '2021-06-30 17:40:23'),
(2, 'opd_no', 'OPDN', '2021-02-22 13:38:01'),
(3, 'ipd_prescription', 'IPDP', '2021-02-12 18:42:07'),
(4, 'opd_prescription', 'OPDP', '2021-02-12 18:42:17'),
(5, 'appointment', 'APPN', '2021-10-22 05:37:43'),
(6, 'pharmacy_billing', 'PHAB', '2021-10-22 05:37:43'),
(7, 'operation_theater_reference_no', 'OTRN', '2021-10-22 05:37:43'),
(8, 'blood_bank_billing', 'BLBB', '2021-10-22 05:40:38'),
(9, 'ambulance_call_billing', 'AMCB', '2021-10-22 05:40:38'),
(10, 'radiology_billing', 'RADB', '2021-10-22 05:40:38'),
(11, 'pathology_billing', 'PATB', '2021-10-22 05:40:38'),
(12, 'checkup_id', 'OCID', '2021-10-22 05:44:25'),
(13, 'purchase_no', 'PHPN', '2021-10-22 05:44:25'),
(14, 'transaction_id', 'TRID', '2021-10-22 05:44:25'),
(15, 'birth_record_reference_no', 'BRRN', '2021-10-22 05:44:25'),
(16, 'death_record_reference_no', 'DRRN', '2021-10-22 05:44:25');

INSERT INTO `referral_type` (`id`, `name`, `prefixes_type`, `is_active`, `created_at`) VALUES
(1, 'opd', 'opd_no', 1, '2021-09-17 02:07:51'),
(2, 'ipd', 'ipd_no', 1, '2021-09-17 02:07:51'),
(3, 'pharmacy', 'pharmacy_billing', 1, '2021-09-17 02:07:51'),
(4, 'pathology', 'pathology_billing', 1, '2021-09-17 02:07:51'),
(5, 'radiology', 'radiology_billing', 1, '2021-09-17 02:07:51'),
(6, 'blood_bank', 'blood_bank_billing', 1, '2021-09-17 02:07:51'),
(7, 'ambulance', 'ambulance_call_billing', 1, '2021-09-17 02:07:51');

INSERT INTO `system_notification_setting` (`id`, `event`, `subject`, `staff_message`, `is_staff`, `patient_message`, `is_patient`, `variables`, `url`, `patient_url`, `notification_type`, `is_active`, `created_at`) VALUES
(1, 'notification_appointment_created', 'New Appointment Created', 'Appointment has been created for Patient: {{patient_name}} ({{patient_id}}). Appointment Date: {{appointment_date}}  With Doctor Name: {{doctor_name}}.', 1, 'Dear {{patient_name}} ({{patient_id}}) your appointment has been created with Doctor: {{doctor_name}}.', 1, '{{appointment_date}} {{patient_name}} {{patient_id}} {{doctor_name}} {{message}}', '', '', 'appointment', 1, '2021-09-17 02:54:13'),
(2, 'appointment_approved', 'Appointment Status', 'Patient: {{patient_name}} ({{patient_id}}) appointment status is {{appointment_status}} with Doctor:  {{doctor_name}} Date: {{appointment_date}}.', 1, 'Dear {{patient_name}} ({{patient_id}}) your appointment status is {{appointment_status}} Date: {{appointment_date}} with Doctor {{doctor_name}}.', 1, '{{appointment_date}} {{patient_name}} {{patient_id}} {{doctor_name}} {{message}} {{appointment_status}}', '', '', 'appointment', 1, '2021-09-17 02:54:13'),
(3, 'opd_visit_created', 'New OPD Created', 'OPD has been created for patient: {{patient_name}} ({{patient_id}}) with doctor: {{doctor_name}}. Patient symptoms details are {{symptoms_description}} and known allergies are: {{any_known_allergies}} .', 1, 'Dear: {{patient_name}} ({{patient_id}}) your OPD has been created with doctor: {{doctor_name}}.  Your symptoms details are {{symptoms_description}} and known allergies are: {{any_known_allergies}}. ', 1, '{{patient_name}} {{patient_id}} {{symptoms_description}} {{any_known_allergies}} {{appointment_date}} {{doctor_name}}', '', '', 'opd', 1, '2021-09-17 02:54:13'),
(4, 'notification_opd_prescription_created', 'OPD Prescription Created', 'OPD prescription has been created for patient: {{patient_name}} ({{patient_id}}) checkup id: ({{checkup_id}}) prescription: {{prescription_no}} prescribe by: {{prescribe_by}}.  \r\n\r\n Prescription Details -\r\n(1) Finding Description: {{finding_description}}\r\n(2) Medicine Details: {{medicine}}\r\n(3) Radiology Test: {{radilogy_test}}\r\n(4) Pathology Test: {{pathology_test}}', 1, 'Dear {{patient_name}} ({{patient_id}}) your prescription has been created with checkup id: ({{checkup_id}}), opd no: ({{opd_no}}). Please check following details about your prescription, prescribe by: {{prescribe_by}}.\r\n\r\n Prescription Details -\r\n(1) Finding Description: {{finding_description}}\r\n(2) Medicines Details: {{medicine}}\r\n(3) Radiology Test: {{radilogy_test}}\r\n(4) Pathology Test: {{pathology_test}}', 1, '{{prescription_no}} {{opd_no}} {{checkup_id}} {{finding_description}} {{medicine}} {{radilogy_test}} {{pathology_test}} {{prescribe_by}} {{generated_by}} {{patient_name}} {{patient_id}}', '', '', 'opd', 1, '2021-09-17 02:54:13'),
(5, 'add_opd_patient_charge', 'OPD Charges Added', 'OPD charges has been added for patient: {{patient_name}} ({{patient_id}}), opd no: ({{opd_no}}), date: {{date}}. OPD  charges details are charge type:{{charge_type}}, charge category: {{charge_category}} and charge name: {{charge_name}}, quantity: {{qty}}. Total net payable bill amount is {{net_amount}}.', 1, 'Dear {{patient_name}}({{patient_id}}), OPD charges has been added in your opd no: ({{opd_no}}). OPD  charges details are charge type:{{charge_type}}, charge category: {{charge_category}} and charge name: {{charge_name}}, quantity: {{qty}}. Total net payable bill amount is {{net_amount}}.', 1, '{{patient_name}} {{patient_id}}  {{opd_no}} {{charge_type}} {{charge_category}} {{charge_name}} {{qty}} {{net_amount}} {{date}} {{doctor_name}}', '', '', 'opd', 1, '2021-09-17 02:54:13'),
(6, 'add_opd_payment', 'OPD Payment Added', 'OPD payment has been received from patient: {{patient_name}}({{patient_id}}) opd no: ({{opd_no}}), transaction id: {{transaction_id}}, payment date: {{date}}, payment amount: {{amount}}, payment mode: {{payment_mode}}.', 1, 'Dear {{patient_name}} ({{patient_id}}) your payment successfully received for opd no: {{opd_no}}, transaction id: {{transaction_id}}, payment date: {{date}}, payment amount: {{amount}}, payment mode: {{payment_mode}}. ', 1, '{{patient_name}} {{patient_id}} {{opd_no}} {{date}} {{amount}} {{payment_mode}} {{transaction_id}}', '', '', 'opd', 1, '2021-09-17 02:54:13'),
(7, 'add_opd_medication_dose', 'OPD Medication Dose', 'Consultant doctor: {{doctor_name}} has given medicine: {{medicine_name}}, category is {{medicine_category}}, dosage: {{dosage}}, for opd no:  {{opd_no}}, patient name:{{patient_name}}, medicine time:  {{date}} {{time}}.', 1, 'Dear {{patient_name}} ({{patient_id}}) OPD Number: {{opd_no}} you have been given the Medicine is {{medicine_name}} Dose ({{dosage}}) medicine time {{date}} {{time}}.', 1, '{{patient_name}} {{patient_id}}  {{opd_no}} {{case_id}} \r\n{{date}} {{time}}  {{medicine_name}} {{dosage}} {{medicine_category}}  {{doctor_name}}', '', '', 'opd', 1, '2021-09-17 02:54:13'),
(8, 'add_nurse_note', 'New IPD Nurse Note', 'Add New Nurse Note for IPD Number: ({{ipd_no}}) Patient: {{patient_name}} ({{patient_id}}) Case ID: {{case_id}} with consultant doctor  {{doctor_name}}. \r\n\r\nNurse Note Details:\r\n(1) Nurse Name: {{nurse_name}} ({{nurse_id}})\r\n(2) Note: {{note}}\r\n(3) Comment: {{comment}}', 1, 'Dear {{patient_name}} ({{patient_id}}) IPD Number: ({{ipd_no}}) and Case ID: {{case_id}} your consultant doctor is {{doctor_name}}. \r\n\r\nNurse Note Details:\r\n(1) Nurse Name: {{nurse_name}} ({{nurse_id}})\r\n(2) Note: {{note}}\r\n(3) Comment: {{comment}}', 1, '{{patient_name}} {{patient_id}} {{ipd_no}} {{case_id}} {{doctor_name}} {{date}} {{nurse_name}} {{nurse_id}} {{note}} {{comment}}', '', '', 'ipd', 1, '2021-09-17 02:54:13'),
(9, 'move_in_ipd_from_opd', 'Patient Move in IPD From OPD', 'Patient {{patient_name}} ({{patient_id}}) move in IPD From OPD. Symptoms Details: {{symptoms_description}} and known allergies is  {{any_known_allergies}}. The patient is being shifted from opd to ipd whose consultant doctor is {{doctor_name}}.', 1, 'Dear {{patient_name}} ({{patient_id}}) you have been shifted from OPD to IPD consultant doctor is {{doctor_name}}. Check your symptoms details {{symptoms_description}} and known allergies {{any_known_allergies}}.\r\n\r\n', 1, '{{patient_name}} {{patient_id}} {{symptoms_description}} {{any_known_allergies}} {{appointment_date}} {{doctor_name}}', '', '', 'opd', 1, '2021-09-17 02:54:13'),
(10, 'add_opd_operation', 'New OPD Operation', 'OPD Number: ({{opd_no}}) Patient: {{patient_name}} ({{patient_id}}) Case id: {{case_id}} has been shifted to the operation ward. Consultant Doctor is {{doctor_name}} .\r\n\r\nOperation Details.\r\nOperation Name: {{operation_name}}\r\nOperation Date: {{operation_date}}', 1, 'Dear {{patient_name}} {{patient_id}} your operation {{operation_name}} date is on {{operation_date}} and your consultant doctor is {{doctor_name}}.', 1, '{{patient_name}} {{patient_id}} {{opd_no}} {{case_id}} {{operation_name}} {{operation_date}} {{doctor_name}}', '', '', 'opd', 1, '2021-09-17 02:54:13'),
(11, 'ipd_visit_created', 'New IPD Visit Created', 'IPD Visit has been created for {{patient_name}} ({{patient_id}}) with Doctor: {{doctor_name}}. Patient Symptoms Details are {{symptoms_description}}.', 1, 'Dear {{patient_name}} ({{patient_id}}) your IPD visit has been created .', 1, '{{patient_name}} {{patient_id}} {{symptoms_description}} {{admission_date}} {{doctor_name}} {{bed_location}}', '', '', 'ipd', 1, '2021-09-17 02:54:13'),
(12, 'notification_ipd_prescription_created', 'Notification IPD Prescription Created', 'Prescription({{prescription_no}}) for IPD ({{ipd_no}}) prescribe by: {{priscribe_by}}. \r\n\r\nPrescription  Details-\r\nFinding Description: {{finding_description}}\r\nMedicine Name: {{medicine}}\r\nRadiology Test: {{radilogy_test}}\r\nPathology Test: {{pathology_test}}\r\n{{priscribe_by}}', 1, 'Dear {{patient_name}} {{patient_id}} your IPD prescription number {{prescription_no}} is prescribe by: {{priscribe_by}}. \r\n\r\nPrescription  Details-\r\n Finding Description: {{finding_description}}\r\n Medicine Name : {{medicine}}\r\n Radiology Test: {{radilogy_test}}\r\n Pathology Test: {{pathology_test}}', 1, '{{prescription_no}} {{ipd_no}} {{finding_description}} {{medicine}} {{radilogy_test}} {{pathology_test}} {{priscribe_by}} {{generated_by}} {{patient_name}} {{patient_id}}', '', '', 'ipd', 1, '2021-09-17 02:54:13'),
(14, 'add_ipd_operation', 'Add IPD Operation', 'Patient Name : {{patient_name}} ({{patient_id}}) IPD Number : {{ipd_no}} Case Id : {{case_id}} has been shifted to the operation ward. Whose doctor is {{doctor_name}}.\r\n\r\nOperation Details-\r\n(1) Operation Name: {{operation_name}}\r\n(2) Operation  Date:  {{operation_date}}', 1, 'Dear {{patient_name}} ({{patient_id}}) your operation {{operation_name}} date is on {{operation_date}} with {{doctor_name}}.', 1, '{{patient_name}} {{patient_id}} {{ipd_no}} {{case_id}} {{operation_name}} {{operation_date}} {{doctor_name}}', '', '', 'ipd', 1, '2021-09-17 02:54:13'),
(15, 'add_ipd_generate_bill', 'Add IPD Generate Bill', 'Generated bill for IPD Number {{ipd_no}}  Patient Name {{patient_name}} {{patient_id}} .\r\n\r\nBill Details\r\nTotal Amount {{total}}\r\nNet Amount {{net_amount}}\r\nTax  {{tax}}\r\nPaid Amount   {{paid}}\r\nDue Amount   {{due}}', 1, 'Dear {{patient_name}} {{patient_id}}  your IPD bill is generated for Case Id {{case_id}} .\r\n\r\nBill Details\r\nTotal Amount {{total}}\r\nNet Amount {{net_amount}}\r\nTax  {{tax}}\r\nPaid Amount   {{paid}}\r\nDue Amount   {{due}}', 1, '{{patient_name}} {{patient_id}} {{ipd_no}} {{case_id}} {{net_amount}} {{total}} {{tax}} {{paid}} {{due}}', '', '', 'ipd', 1, '2021-09-17 02:54:13'),
(16, 'add_ipd_patient_charge', 'Add IPD Patient Charge', 'Add Charge for IPD Patient Name : {{patient_name}} ({{patient_id}}) IPD Number ({{ipd_no}}) has applied charge {{charge_type}}, category  {{charge_category}}, and Name {{charge_name}} total quantity {{qty}} . Now total net amount {{net_amount}} date {{date}}.', 1, 'Dear {{patient_name}} ({{patient_id}}) IPD Number {{ipd_no}} you have applied charge name is {{charge_type}}, category {{charge_category}} ,charge name {{charge_name}}  and total quantity {{qty}} now your net amount {{net_amount}} and date {{date}}.', 1, '{{patient_name}} {{patient_id}} {{ipd_no}} {{charge_type}} {{charge_category}} {{charge_name}} {{qty}} {{net_amount}} {{date}}', '', '', 'ipd', 1, '2021-09-17 02:54:13'),
(17, 'add_ipd_payment', 'Add IPD Payment', 'Payment has been received from Patient Name: {{patient_name}} ({{patient_id}}) IPD NO: {{ipd_no}} transaction id: {{transaction_id}} payment date: {{date}} payment amount: {{amount}} payment mode: {{payment_mode}}.', 1, 'Dear {{patient_name}} ({{patient_id}}) IPD: {{ipd_no}} we have received your payment amount ({{amount}}) transaction id: {{transaction_id}} payment date: {{date}} payment mode: {{payment_mode}} .', 1, '{{patient_name}} {{patient_id}} {{ipd_no}} {{date}} {{amount}} {{payment_mode}} {{transaction_id}}', '', '', 'ipd', 1, '2021-09-17 02:54:13'),
(18, 'add_ipd_medication_dose', 'Add IPD Medication Dose', 'Doctor {{doctor_name}}  has given medicine {{medicine_name}} Category is {{medicine_category}} Dosage {{dosage}} to Patient:  {{patient_name}} {{patient_id}} at {{date}} {{time}}.', 1, 'Dear {{patient_name}} ({{patient_id}}) IPD Number {{ipd_no}} you have been given the {{medicine_name}} dose {{dosage}} of medicine at {{date}} {{time}}.', 1, '{{patient_name}} {{patient_id}} {{ipd_no}} {{case_id}} {{date}} {{time}} {{medicine_name}} {{dosage}} {{medicine_category}} {{doctor_name}}', '', '', 'ipd', 1, '2021-09-17 02:54:13'),
(20, 'add_consultant_register', 'Add Consultant Register', 'New Consultant Register: {doctor_name}} has been added  some instructions: {{instruction}} on date {{applied_date}} for the patients {{patient_name}} ({{patient_id}}) of IPD {{ipd_no}}.', 1, 'Dear {{patient_name}} ({{patient_id}}) IPD Number: ({{ipd_no}}). Consultant: {{doctor_name}} has added some instructions: {{instruction}} on applied date {{applied_date}}.', 1, '{{patient_name}} {{patient_id}} {{ipd_no}} {{case_id}} {{applied_date}} {{instruction_date}} {{doctor_name}} {{instruction}}', '', '', 'ipd', 1, '2021-09-17 02:54:13'),
(22, 'pharmacy_generate_bill', 'Pharmacy Generate Bill', 'Pharmacy Bill Generated for Patient: {{patient_name}} ({{patient_id}}) Case ID: {{case_id}}.\r\n\r\nPharmacy Bill Details-\r\nTotal Amount: {{total}}\r\nNet Amount: {{net_amount}}\r\nDiscount: {discount}} \r\nTax: {{tax}}\r\nPaid Amount  $ {{paid}}\r\nDue Amount  $ {{due_amount}}', 1, 'Dear {{patient_name}} {{patient_id}} your pharmacy bill is generated. \r\n\r\nBill Details-\r\nTotal Amount: {{total}}\r\nNet Amount: {{net_amount}}\r\nDiscount: {{discount}}\r\nTax: {{tax}}\r\nPaid Amount: {{paid}}\r\nDue Amount: {{due_amount}}', 1, '{{patient_name}} {{patient_id}} {{case_id}} {{bill_no}} {{medicine_details}} {{doctor_name}} {{total}} {{discount}} {{tax}} {{net_amount}} {{date}} {{paid}} {{due_amount}}', '', '', 'pharmacy', 1, '2021-09-17 02:54:13'),
(23, 'add_medicine', 'Add Medicine', 'New Add Medicine Details: \r\n\r\nMedicine Name  {{medicine_name}} , \r\nMedicine Category  {{medicine_category}} ,\r\nMedicine Company  {{medicine_company}} ,\r\nMedicine Composition  {{medicine_composition}} ,\r\nMedicine Group {{medicine_group}} , \r\nUnit {{unit}} ,\r\nPacking  {{unit_packing}} ,', 1, '', 0, '{{medicine_name}} {{medicine_category}} {{medicine_company}} {{medicine_composition}} {{medicine_group}} {{unit}} {{unit_packing}}', '', '', 'pharmacy', 1, '2021-09-17 02:54:13'),
(24, 'add_bad_stock', 'Add Bad Stock', 'Add Bad Stock Details :\r\n\r\nBatch No {{batch_no}}\r\nExpiry Date  {{expiry_date}}\r\nOutward Date   {{outward_date}}  \r\n Total Qty  {{qty}}', 1, '', 0, '{{batch_no}} {{expiry_date}} {{outward_date}} {{qty}}', '', '', 'pharmacy', 1, '2021-09-17 02:54:13'),
(25, 'purchase_medicine', 'Purchase Medicine', 'Purchase Medicine Details :\r\nSupplier Name: {{supplier_name}} \r\nMedicine Details: {{medicine_details}}\r\nPurchase Date: {{purchase_date}}\r\nInvoice Number:  {{invoice_number}}\r\nTotal: {{total}}\r\nDiscount: {{discount}} \r\nTax: {{tax}}\r\nNet Amount: {{net_amount}}', 1, '', 0, '{{supplier_name}} {{medicine_details}} {{purchase_date}} {{invoice_number}} {{total}} {{discount}} {{tax}} {{net_amount}}', '', '', 'pharmacy', 1, '2021-09-17 02:54:13'),
(26, 'pathology_investigation', 'Pathology Investigation', 'Pathology Test Report for Patient: {{patient_name}} ({{patient_id}}) case id: {{case_id}}. Pathology test assign by {{doctor_name}}. pathology charge- total amount {{total}}, discount {{discount}} ,tax {{tax}}  net amount is {{net_amount}} and total paid amount {{paid_amount}}.', 1, 'Dear {{patient_name}} ({{patient_id}}) case id: {{case_id}}. Your pathology test bill number is {{bill_no}} and total amount {{total}}, tax {{tax}}, discount {{discount}} so now your net amount is {{net_amount}}.  You have paid your total amount {{paid_amount}}.', 1, '{{patient_name}} {{patient_id}} {{case_id}} {{bill_no}} {{date}} {{doctor_name}}  {{total}} {{discount}} {{tax}} {{net_amount}} {{paid_amount}}', '', '', 'pathology', 1, '2021-09-17 02:54:13'),
(27, 'pathology_sample_collection', 'Pathology Sample Collection', 'Pathology Bill Number {{bill_no}} Patient: {{patient_name}} ({{patient_id}}) Case id: {{case_id}}. Sample Collected  by  {{sample_collected_person_name}} on {{collected_date}} from {{pathology_center}} and report expected date is {{expected_date}}.', 1, 'Dear {{patient_name}} {{patient_id}} Case id: {{case_id}}  your pathology test sample collected by {{sample_collected_person_name}} on {{collected_date}} from {{pathology_center}} . Pathology Test report expected date {{expected_date}}. ', 1, '{{patient_name}} {{patient_id}} {{case_id}} {{bill_no}} {{test_name}} {{sample_collected_person_name}} {{collected_date}} {{pathology_center}} {{expected_date}} {{doctor_name}}', '', '', 'pathology', 1, '2021-09-17 02:54:13'),
(28, 'pathology_test_report', 'Pathology Test Report', 'Pathology Test Report Bill Number {{bill_no}} for Patient Name is {{patient_name}} {{patient_id}} Case id {{case_id}} and test approved by {{approved_by}} on {{approve_date}} . Pathology Test {{test_name}} sample collected by {{sample_collected_person_name}} on {{collected_date}} from {{pathology_center}} and Expected date {{expected_date}} . {{doctor_name}}', 1, 'Dear {{patient_name}} {{patient_id}} Case id  {{case_id}}. Your Pathology Test {{test_name}} sample collected by {{sample_collected_person_name}} on  {{collected_date}} from {{pathology_center}} .', 1, '{{patient_name}} {{patient_id}} {{case_id}} {{bill_no}} {{test_name}} {{sample_collected_person_name}} {{collected_date}} {{pathology_center}} {{expected_date}} {{approved_by}} {{approve_date}} {{doctor_name}}', '', '', 'pathology', 1, '2021-09-17 02:54:13'),
(29, 'radiology_investigation', 'Radiology Investigation', 'Radiology Test Report for Patient: {{patient_name}} ({{patient_id}}) case id: {{case_id}}. Radiology test assign by {{doctor_name}}. Test Charge total amount {{total}}, total discount {{discount}}, tax {{tax}}.', 1, 'Dear {{patient_name}} ({{patient_id}}) case id: {{case_id}}. Your Radiology test bill number is {{bill_no}},  total bill amount {{total}} tax {{tax}}, discount {{discount}} so now your net amount {{net_amount}} and total paid amount is {{paid}}. ', 1, '{{patient_name}} {{patient_id}} {{case_id}} {{bill_no}} {{date}} {{doctor_name}}  {{total}} {{net_amount}} {{paid}} {{discount}} {{tax}}', '', '', 'radiology', 1, '2021-09-17 02:54:13'),
(30, 'radiology_sample_collection', 'Radiology Sample Collection', 'Radiology Bill Number: {{bill_no}} for Patient: {{patient_name}} ({{patient_id}}) Case id: {{case_id}}. Radiology test name is {{test_name}} and sample collected by {{sample_collected_person_name}} on {{collected_date}} from {{radiology_center}} and report expected date is {{expected_date}}.', 1, 'Dear {{patient_name}} {{patient_id}} Case id: {{case_id}}  your radiology test is {{test_name}} and  sample collected by {{sample_collected_person_name}} on {{collected_date}} from {{radiology_center}}. Test report expected date {{expected_date}}. ', 1, '{{patient_name}} {{patient_id}} {{case_id}} {{bill_no}} {{test_name}} {{sample_collected_person_name}} {{collected_date}} {{radiology_center}} {{expected_date}} {{doctor_name}}', '', '', 'radiology', 1, '2021-09-17 02:54:13'),
(31, 'radiology_test_report', 'Radiology Test Report', 'Radiology Bill Number {{bill_no}} Patient Name {{patient_name}} ({{patient_id}}) Case id ( {{case_id}}). Sample Collected  by  {{sample_collected_person_name}} on {{collected_date}} from {{radiology_center}} and Expected date is {{expected_date}}.', 1, 'Dear {{patient_name}} {{patient_id}} Case id ({{case_id}}) your radiology test sample collected by {{sample_collected_person_name}} on {{collected_date}} from  {{radiology_center}}. radiology test report expected date {{expected_date}} .', 1, '{{patient_name}} {{patient_id}} {{case_id}} {{bill_no}} {{test_name}} {{sample_collected_person_name}} {{collected_date}} {{radiology_center}} {{expected_date}} {{approved_by}} {{approved_date}} {{doctor_name}}', '', '', 'radiology', 1, '2021-09-17 02:54:13'),
(32, 'add_bag_stock', 'Add Bag Stock', 'New Add Bag Stock Details- Donor Name: {{donor_name}}, Blood Group: ({{blood_group}}) and contact number {{contact_no}} . Donate bag details blood bag number ({{bag}}) and charge {{charge_name}} donated date {{donate_date}}. Total amount {{total}} discount {{discount}} tax {{tax}} so total net amount is {{net_amount}}.', 1, '', 0, '{{donor_name}} {{blood_group}} {{contact_no}} {{donate_date}} {{bag}} {{charge_name}} {{total}} {{discount}} {{tax}} {{net_amount}}', '', '', 'blood_bank', 1, '2021-09-17 02:54:13'),
(33, 'blood_issue', 'Blood Issue', 'Blood issue for Bill Number {{bill_no}} Patient: {{patient_name}} ({{patient_id}}) Case Id {{case_id}} . Patient blood group is {{blood_group}} and bag number ({{bag}}) issue on {{issue_date}}, reference by {{reference_name}}. Applied charge name is {{charge_name}} and total amount {{total}}, discount {{discount}}, tax {{tax}}, now total net amount{{net_amount}}.', 1, 'Dear {{patient_name}} ({{patient_id}}) case id: {{case_id}} your bill number {{bill_no}} blood group {{blood_group}} bag number is {{bag}} charge name  {{charge_name}} issue on {{issue_date}} reference by {{reference_name}} .Total amount {{total}}, discount {{discount}}, tax {{tax}} now your total net amount {{net_amount}}.', 1, '{{patient_name}} {{patient_id}} {{case_id}} {{bill_no}} {{issue_date}} {{reference_name}} {{blood_group}} {{bag}} {{charge_name}} {{total}} {{discount}} {{tax}} {{net_amount}} ', '', '', 'blood_bank', 1, '2021-09-17 02:54:13'),
(34, 'add_component_of_blood', 'Add Component of Blood', '{{component_name}} component has been added on the bag number {{bag}} of Blood Group {{blood_group}} .', 1, '', 0, '{{blood_group}} {{bag}} {{ component_name}} {{component_bag}}', '', '', 'blood_bank', 1, '2021-09-17 02:54:13'),
(35, 'component_issue', 'Component Issue', 'Component Issue for  Bill Number {{bill_no}} Patient Name is {{patient_name}} ({{patient_id}}) Case Id: {{case_id}}.  Blood group {{blood_group}} Component: {{component}}, bag number {{bag}} issue on {{issue_date}}  reference by {{reference_name}}. Applied charge name {{charge_name}} total amount {{total}}  discount {{discount}} tax {{tax}} now total net amount {{net_amount}}.', 1, 'Dear {{patient_name}} ({{patient_id}}) {{case_id}} you have issued a component {{component}} Bag number is {{bag}}  blood group is {{blood_group}} issue on  {{issue_date}} reference by {{reference_name}} . Total amount {{total}} Discount {{discount}} Tax {{tax}} now your total net amount  is {{net_amount}}.', 1, '{{patient_name}} {{patient_id}} {{case_id}} {{bill_no}} {{issue_date}} {{reference_name}} {{blood_group}} {{component}} {{bag}} {{charge_name}} {{total}} {{discount}} {{tax}} {{net_amount}} ', '', '', 'blood_bank', 1, '2021-09-17 02:54:13'),
(36, 'live_opd_consultation_add', 'Live OPD Consultation Add', 'Live Consultation for  OPD {{opd_no}} Patient  Name {{patient_name}} {{patient_id}}  with Consultant Doctor {{doctor_name}} {{doctor_id}} . Live consulatent Title  {{consultation_title}} Date {{consultation_date}} minutes {{consultation_date}} {{consultation_duration_minutes}}.', 1, 'Dear {{patient_name}} {{patient_id}} your live consultation subject {{consultation_title}} date {{consultation_date}} minute {{consultation_duration_minutes}}  with Consultant Doctor {{doctor_name}} ({{doctor_id}}).', 1, '{{patient_name}} {{patient_id}} {{consultation_title}} {{consultation_date}} {{consultation_duration_minutes}}  {{opd_no}} {{checkup_id}} {{doctor_id}} {{doctor_name}}', '', '', 'live_consultation', 1, '2021-09-17 02:54:13'),
(37, 'live_opd_consultation_start', 'Live Opd Consultation Start', 'patient_name: {{patient_name}} patient_id: {{patient_id}} consultation_title: {{consultation_title}} consultation_date: {{consultation_date}}  consultation_duration_minutes: {{consultation_duration_minutes}} opd_no: {{opd_no}} checkup_id: {{checkup_id}} doctor_name: {{doctor_name}}', 1, 'patient_name: {{patient_name}} patient_id: {{patient_id}} consultation_title: {{consultation_title}} consultation_date: {{consultation_date}}  consultation_duration_minutes: {{consultation_duration_minutes}} opd_no: {{opd_no}} checkup_id: {{checkup_id}} doctor_name: {{doctor_name}}', 1, '{{patient_name}} {{patient_id}} {{consultation_title}} {{consultation_date}} {{consultation_duration_minutes}}  {{opd_no}} {{checkup_id}} {{doctor_name}}', '', '', 'live_consultation', 1, '2021-09-17 02:54:13'),
(38, 'live_meeting_start', 'Live Meeting Start', 'Live Meeting has been created for Staff: {{staff_list}}  Meeting Title is {{meeting_title}}  and Meeting Date {{meeting_date}} Meeting Duration Minutes: {{meeting_duration_minutes}}.', 1, '', 0, '{{meeting_title}} {{meeting_date}} {{meeting_duration_minutes}} {{staff_list}}', '', '', 'live_consultation', 1, '2021-09-17 02:54:13'),
(39, 'live_meeting_add', 'Live Meeting Add', 'Live Meeting Created for Staff {{staff_list}} and  Meeting Title is {{meeting_title}} on Meeting Date {{meeting_date}} Meeting Duration Minutes{{meeting_duration_minutes}} .', 1, '', 0, '{{meeting_title}} {{meeting_date}} {{meeting_duration_minutes}} {{staff_list}}', '', '', 'live_consultation', 1, '2021-09-17 02:54:13'),
(40, 'add_referral_payment', 'Add Referral Payment', 'Patient Name {{patient_name}} ({{patient_id}}) in {{patient_type}} Bill number {{bill_no}} and patient bill amount is {{patient_bill_amount}}. Commission percentage of total bill {{commission_percentage}}. Commission amount {{commission_amount}} has been given to the payee {{payee}}.', 1, '', 0, '{{patient_name}} {{patient_id}} {{patient_type}} {{bill_no}} {{patient_bill_amount}} {{payee}} {{commission_percentage}} {{commission_amount}}', '', '', 'referral', 1, '2021-09-17 02:54:13'),
(41, 'patient_certificate_generate', 'Patient Certificate Generate', 'Patient Name {{patient_name}} {{patient_id}} certificate {{certificate_name}} has been generated. OPD/ IPD number {{opd_ipd_no}}.', 1, 'Dear Patient {{patient_name}} {{patient_id}} OPD / IPD number is {{opd_ipd_no}}  your certificate {{certificate_name}} has been generated.', 1, '{{patient_name}} {{patient_id}} {{opd_ipd_no}} {{certificate_name}}', '', '', 'certificate', 1, '2021-09-17 02:54:13'),
(42, 'patient_id_card_generate', 'remaining', 'ID Card is generated for Patient Name {{patient_name}} {{patient_id}} .', 1, 'Dear {{patient_name}} {{patient_id}} your id card is generated .', 1, '{{patient_name}} {{patient_id}}  {{id_card_template}}', '', '', 'certificate', 1, '2021-09-17 02:54:13'),
(43, 'generate_staff_id_card', 'Generate Staff ID Card', 'Staff ID card is generated for Role: {{role}}, staff name {{staff_name}} suename {{staff_surname}} employee id: {{employee_id}}.', 1, '', 0, '{{role}} {{staff_name}} {{staff_surname}} {{employee_id}} {{id_card_template}}', '', '', 'certificate', 1, '2021-09-17 02:54:13'),
(44, 'create_ambulance_call', 'Create Ambulance Call', '{{patient_name}} {{patient_id}} has booked an ambulance on {{date}} his charge name {{charge_name}} tax {{tax}}  net amount {{net_amount}} and total paid  amount {{paid_amount}}.\r\n\r\nAmbulance Details \r\n\r\nVehicle Model  {{vehicle_model}}\r\nDriver Name  {{driver_name}}', 1, 'Dear {{patient_name}} {{patient_id}} your ambulance is booked on {{date}} . Charge applied {{charge_name}}, tax {{tax}} net amount is {{net_amount}} and your paid amount is {{paid_amount}} .\r\n\r\nAmbulance Details-\r\nVehicle Model: {{vehicle_model}}\r\nDriver Name: {{driver_name}}', 1, '{{patient_name}} {{patient_id}} {{vehicle_model}} {{driver_name}} {{date}} {{charge_name}} {{tax}} {{net_amount}} {{paid_amount}}', '', '', 'ambulance', 1, '2021-09-17 02:54:13'),
(45, 'add_birth_record', 'Add Birth Record', 'Patient {{mother_name}} ({{mother_id}}) has given birth to a new baby {{child_name}} on {{birth_date}}.', 1, 'Dear {{mother_name}} {{mother_id}} case id : {{case_id}} your baby {{child_name}} is born on {{birth_date}}.', 1, '{{mother_name}} {{mother_id}} {{child_name}} {{birth_date}} {{case_id}}', '', '', 'birth_death_record', 1, '2021-09-17 02:54:13'),
(46, 'add_death_record', 'Add Death Record', 'Patient {{patient_name}} ({{patient_id}}) Case id :{{case_id}} has died on {{death_date}}.', 1, '', 0, '{{case_id}} {{patient_name}} {{patient_id}} {{death_date}}', '', '', 'birth_death_record', 1, '2021-09-17 02:54:13'),
(47, 'staff_enabale_disable', 'Staff Enabale/Disable', 'Staff Name: {{staff_name}} surname: {{staff_surname}} Employment ID: ({{employee_id}}) has been {{status}}.', 1, '', 0, '{{staff_name}} {{staff_surname}} {{employee_id}} {{status}}', '', '', 'human_resource', 1, '2021-09-17 02:54:13'),
(48, 'staff_generate_payroll', 'Staff Generate Payroll', 'Payroll Generated for  Month {{month}} year {{year}}  Role {{role}} . Basic Salary is {{basic_salary}} Earning  {{earning}} Deduction {{deduction}} Gross salary  {{gross_salary}}.  Now Total Net Salary {{net_salary}}.', 1, '', 0, '{{role}} {{month}} {{year}} {{basic_salary}} {{earning}} {{deduction}} {{gross_salary}} {{tax_amount}} {{net_salary}}', '', '', 'human_resource', 1, '2021-09-17 02:54:13'),
(49, 'staff_leave', 'Staff Leave', 'Staff {{staff_name}} {{staff_surname}} ({{employee_id}}) has applied leave on Date {{apply_date}} for leave {{days}} days. date {{leave_date}} . Currently Leave Status is {{leave_status}} .', 1, '', 0, '{{apply_date}} {{leave_type}} {{leave_date}} {{days}} {{staff_name}} {{staff_surname}} {{employee_id}}\r\n{{leave_status}}', '', '', 'human_resource', 1, '2021-09-17 02:54:13'),
(50, 'staff_leave_status', 'Staff Leave Status', 'Staff Name {{staff_name}} {{staff_surname}} {{employee_id}} has applied leave for {{days}} days. leave date: {{leave_date}}, Leave Status:  {{leave_status}}.', 1, '', 0, '{{apply_date}} {{leave_type}} {{leave_date}} {{days}} {{staff_name}} {{staff_surname}} {{employee_id}}\r\n{{leave_status}}', '', '', 'human_resource', 1, '2021-09-17 02:54:13'),
(51, 'live_ipd_consultation_add', 'Live IPD Consultation Add', 'Live Consultation for IPD {{ipd_no}} Patient  Name {{patient_name}} {{patient_id}} with Consultant Doctor {{doctor_name}} {{doctor_id}} . Live consulatent Title  {{consultation_title}} Date {{consultation_date}} minutes {{consultation_date}} {{consultation_duration_minutes}}.', 1, 'Dear {{patient_name}} {{patient_id}} your live consultation subject {{consultation_title}} date {{consultation_date}} minute {{consultation_duration_minutes}}  with Consultant Doctor {{doctor_name}} ({{doctor_id}}).', 1, '{{patient_name}} {{patient_id}} {{consultation_title}} {{consultation_date}} {{consultation_duration_minutes}} \r\n{{ipd_no}} {{doctor_id}} {{doctor_name}}', '', '', 'live_consultation', 1, '2021-09-17 02:54:13'),
(52, 'live_ipd_consultation_start', 'Live IPD Consultation Start', 'IPD No {{ipd_no}} Patient Name {{patient_name}} {{patient_id}}. Live Consultation Doctor {{doctor_name}}. \r\n\r\nLive Consultation Details.\r\nConsultation Title {{consultation_title}}\r\nConsultation Date  {{consultation_date}}\r\nConsultation Duration Minutes  {{consultation_duration_minutes}}', 1, 'Dear patient patient_name: {{patient_name}} patient_id: {{patient_id}} , your live consultation consultation_title: {{consultation_title}} has been scheduled on Consultation Date: {{consultation_date}} for the duration of consultation_duration_minutes: {{consultation_duration_minutes}} minute, ipd_no: {{ipd_no}} and your consultant doctor doctor_name: {{doctor_name}}  please do not share the link to any body.', 1, '{{patient_name}} {{patient_id}} {{consultation_title}} {{consultation_date}} {{consultation_duration_minutes}}  {{ipd_no}} {{doctor_name}}', '', '', 'live_consultation', 1, '2021-09-17 02:54:13'),
(53, 'add_ipd_discharge_patient', 'Add IPD Discharge Patient', 'IPD Patient: {{patient_name}}({{patient_id}}) status: ({{discharge_status}}) on {{discharge_date}}.', 1, 'Dear {{patient_name}} {{patient_id}} you have been {{discharge_status}} on {{discharge_date}}.', 1, '{{patient_name}} {{patient_id}} {{discharge_status}} {{discharge_date}} {{ipd_no}} {{case_id}}', '', '', 'ipd', 1, '2021-09-17 02:54:13'),
(54, 'add_opd_discharge_patient', 'Add OPD Discharge Patient', 'OPD Patient {{patient_name}} {{patient_id}} discharge status: {discharge_status}} on {{discharge_date}}.', 1, '\r\nDear {{patient_name}} {{patient_id}} you have been {{discharge_status}} on {{discharge_date}}.', 1, '{{patient_name}} {{patient_id}} {{discharge_status}} {{discharge_date}} {{opd_no}} {{case_id}}', '', '', 'opd', 1, '2021-09-17 02:54:13'),
(55, 'add_payroll_payment', 'Add Payroll Payment', 'Month {{month}} salary amount {{payment_amount}} has been given to staff name {{staff}} on date {{payment_date}}.', 1, 'staff: {{staff}} payment_amount: {{payment_amount}} month: {{month}} year: {{year}} payment_mode: {{payment_mode}} payment_date: {{payment_date}}\r\n', 0, '{{staff}} {{payment_amount}} {{month}} {{year}} {{payment_mode}} {{payment_date}}', '', '', 'human_resource', 1, '2021-09-17 02:54:13'),
(56, 'add_opd_generate_bill', 'Add OPD Generate Bill', 'Generated bill for OPD Number {{opd_id}}  Patient Name {{patient_name}} {{patient_id}} .\r\n\r\nBill Details\r\nTotal Amount {{total}}\r\nNet Amount {{net_amount}}\r\nTax  {{tax}}\r\nPaid Amount   {{paid}}\r\nDue Amount   {{due}}', 1, 'Dear {{patient_name}} {{patient_id}}  your OPD bill is generated for Case Id {{case_id}} .\r\n\r\nBill Details\r\nTotal Amount {{total}}\r\nNet Amount {{net_amount}}\r\nTax  {{tax}}\r\nPaid Amount   {{paid}}\r\nDue Amount   {{due}}', 1, '{{patient_name}} {{patient_id}} {{opd_id}} {{case_id}} {{net_amount}} {{total}} {{tax}} {{paid}} {{due}}', '', '', 'opd', 1, '2021-09-17 02:54:13'),
(57, 'patient_consultation_add', 'Patient Consultation Add', 'Live Consultation for Patient  Name {{patient_name}} {{patient_id}}  with Consultant Doctor {{doctor_name}} . Live consulatent Title  {{consultation_title}} Date {{consultation_date}} minutes {{consultation_date}} {{consultation_duration_minutes}}.', 1, 'Dear {{patient_name}} {{patient_id}} your live consultation subject {{consultation_title}} date {{consultation_date}} minute {{consultation_duration_minutes}}  with Consultant Doctor {{doctor_name}}.', 1, '{{patient_name}} {{patient_id}} {{consultation_title}} {{consultation_date}} {{consultation_duration_minutes}}  {{checkup_id}} {{doctor_name}}', '', '', 'live_consultation', 1, '2021-09-17 02:54:13'),
(58, 'opd_patient_discharge_revert', 'opd_patient_discharge_revert', 'patient_name: {{patient_name}} patient_id: {{patient_id}} discharge_status: {{discharge_status}} discharge_date: {{discharge_date}} opd_no: {{opd_no}} case_id: {{case_id}}', 1, 'patient_name: {{patient_name}} patient_id: {{patient_id}} discharge_status: {{discharge_status}} discharge_date: {{discharge_date}} opd_no: {{opd_no}} case_id: {{case_id}}', 1, '{{patient_name}} {{patient_id}} {{discharge_status}} {{discharge_date}} {{opd_no}} {{case_id}}', '', '', 'opd', 1, '2021-09-17 02:54:13'),
(59, 'ipd_patient_discharge_revert', 'ipd_patient_discharge_revert', 'patient_name: {{patient_name}} patient_id: {{patient_id}} discharge_status: {{discharge_status}} discharge_date: {{discharge_date}} ipd_no: {{ipd_no}} case_id: {{case_id}}', 1, 'patient_name: {{patient_name}} patient_id: {{patient_id}} discharge_status: {{discharge_status}} discharge_date: {{discharge_date}} ipd_no: {{ipd_no}} case_id: {{case_id}}', 1, '{{patient_name}} {{patient_id}} {{discharge_status}} {{discharge_date}} {{ipd_no}} {{case_id}}', '', '', 'opd', 1, '2021-09-17 02:54:13');

INSERT INTO `roles` (`id`, `name`, `slug`, `is_active`, `is_system`, `is_superadmin`, `created_at`) VALUES
(50, 'Nurse', NULL, 0, 1, 0, '2020-12-23 01:58:58');

INSERT INTO `permission_group` (`id`, `name`, `short_code`, `is_active`, `system`, `sort_order`, `created_at`) VALUES
(3, 'Income', 'income', 1, 0, '15.00', '2021-10-22 05:37:50'),
(4, 'Expense', 'expense', 1, 0, '16.00', '2021-10-22 05:37:55'),
(8, 'Download Center', 'download_center', 1, 0, '19.00', '2021-10-22 05:43:38'),
(10, 'Inventory', 'inventory', 1, 0, '18.00', '2021-10-22 05:43:22'),
(13, 'Messaging', 'communicate', 1, 0, '17.00', '2021-10-22 05:43:08'),
(14, 'Reports', 'reports', 1, 1, '23.00', '2021-10-22 05:44:35'),
(15, 'System Settings', 'system_settings', 1, 1, '24.00', '2021-10-22 05:46:02'),
(16, 'Front CMS', 'front_cms', 1, 0, '21.00', '2021-10-22 05:44:07'),
(17, 'Front Office', 'front_office', 1, 0, '10.00', '2021-10-22 05:35:56'),
(18, 'Human Resource', 'human_resource', 1, 1, '12.00', '2021-10-22 05:36:27'),
(21, 'Calendar To Do List', 'calendar_to_do_list', 1, 0, '28.00', '2021-10-22 05:52:27'),
(22, 'Dashboard and Widgets', 'dashboard_and_widgets', 1, 1, '0.01', '2021-10-22 05:48:00'),
(23, 'OPD', 'opd', 1, 0, '3.00', '2021-10-22 05:34:29'),
(24, 'IPD', 'ipd', 1, 0, '4.00', '2021-10-22 05:34:38'),
(25, 'Pharmacy', 'pharmacy', 1, 0, '5.00', '2021-10-22 05:34:47'),
(26, 'Pathology', 'pathology', 1, 0, '6.00', '2021-10-22 05:34:59'),
(27, 'Radiology', 'radiology', 1, 0, '7.00', '2021-10-22 05:35:09'),
(29, 'Ambulance', 'ambulance', 1, 0, '9.00', '2021-10-22 05:35:31'),
(30, 'Blood Bank', 'blood_bank', 1, 0, '8.00', '2021-10-22 05:35:21'),
(31, 'TPA Management', 'tpa_management', 1, 0, '14.00', '2021-10-22 05:36:58'),
(32, 'Hospital Charges', 'hospital_charges', 1, 1, '26.00', '2021-10-22 05:49:04'),
(34, 'Birth Death Record', 'birth_death_report', 1, 0, '11.00', '2021-10-22 05:36:10'),
(36, 'Patient', 'patient', 1, 0, '25.00', '2021-10-22 05:48:46'),
(37, 'Live Consultation', 'live_consultation', 1, 0, '22.00', '2021-10-22 05:44:21'),
(38, 'Referral', 'referral', 1, 0, '13.00', '2021-10-22 05:36:48'),
(39, 'Appointment', 'appointment', 1, 0, '2.00', '2021-10-22 05:34:15'),
(41, 'Bill', 'bill', 1, 0, '1.00', '2021-10-22 05:33:47'),
(42, 'Certificate', 'certificate', 1, 0, '20.00', '2021-10-04 09:06:58'),
(43, 'Chat', 'chat', 1, 0, '27.00', '2021-10-22 05:52:19');

INSERT INTO `permission_category` (`id`, `perm_group_id`, `name`, `short_code`, `enable_view`, `enable_add`, `enable_edit`, `enable_delete`, `created_at`) VALUES
(9, 3, 'Income', 'income', 1, 1, 1, 1, '2018-06-22 04:53:21'),
(10, 3, 'Income Head', 'income_head', 1, 1, 1, 1, '2018-06-22 04:52:44'),
(12, 4, 'Expense', 'expense', 1, 1, 1, 1, '2018-06-22 04:54:06'),
(13, 4, 'Expense Head', 'expense_head', 1, 1, 1, 1, '2018-06-22 04:53:47'),
(27, 8, 'Upload Content', 'upload_content', 1, 1, 0, 1, '2018-06-22 05:03:19'),
(31, 10, 'Issue Item', 'issue_item', 1, 1, 0, 1, '2018-12-17 04:25:14'),
(32, 10, 'Item Stock', 'item_stock', 1, 1, 1, 1, '2018-06-22 05:05:17'),
(33, 10, 'Item', 'item', 1, 1, 1, 1, '2018-06-22 05:05:40'),
(34, 10, 'Store', 'store', 1, 1, 1, 1, '2018-06-22 05:06:02'),
(35, 10, 'Supplier', 'supplier', 1, 1, 1, 1, '2018-06-22 05:06:25'),
(43, 13, 'Notice Board', 'notice_board', 1, 1, 1, 1, '2018-06-22 05:11:17'),
(44, 13, 'Email / SMS', 'email_sms', 1, 0, 0, 0, '2018-06-22 05:10:54'),
(48, 14, 'OPD Report', 'opd_report', 1, 0, 0, 0, '2018-12-18 03:29:18'),
(53, 15, 'Languages', 'languages', 1, 1, 0, 0, '2021-09-13 04:26:36'),
(54, 15, 'General Setting', 'general_setting', 1, 0, 1, 0, '2018-07-05 03:38:35'),
(56, 15, 'Notification Setting', 'notification_setting', 1, 0, 1, 0, '2018-07-05 03:38:41'),
(57, 15, 'SMS Setting', 'sms_setting', 1, 0, 1, 0, '2018-07-05 03:38:47'),
(58, 15, 'Email Setting', 'email_setting', 1, 0, 1, 0, '2018-07-05 03:38:51'),
(59, 15, 'Front CMS Setting', 'front_cms_setting', 1, 0, 1, 0, '2018-07-05 03:38:55'),
(60, 15, 'Payment Methods', 'payment_methods', 1, 0, 1, 0, '2018-07-05 03:38:59'),
(61, 16, 'Menus', 'menus', 1, 1, 0, 1, '2018-07-08 22:20:06'),
(62, 16, 'Media Manager', 'media_manager', 1, 1, 0, 1, '2018-07-08 22:20:26'),
(63, 16, 'Banner Images', 'banner_images', 1, 1, 0, 1, '2018-06-22 05:16:02'),
(64, 16, 'Pages', 'pages', 1, 1, 1, 1, '2018-06-22 05:16:21'),
(65, 16, 'Gallery', 'gallery', 1, 1, 1, 1, '2018-06-22 05:17:02'),
(66, 16, 'Event', 'event', 1, 1, 1, 1, '2018-06-22 05:17:20'),
(67, 16, 'News', 'notice', 1, 1, 1, 1, '2018-07-03 03:09:34'),
(80, 17, 'Visitor Book', 'visitor_book', 1, 1, 1, 1, '2018-06-22 05:18:58'),
(81, 17, 'Phone Call Log', 'phone_call_log', 1, 1, 1, 1, '2018-06-22 05:20:57'),
(82, 17, 'Postal Dispatch', 'postal_dispatch', 1, 1, 1, 1, '2018-06-22 05:20:21'),
(83, 17, 'Postal Receive', 'postal_receive', 1, 1, 1, 1, '2018-06-22 05:20:04'),
(84, 17, 'Complain', 'complain', 1, 1, 1, 1, '2018-12-19 03:41:37'),
(85, 17, 'Setup Front Office', 'setup_front_office', 1, 1, 1, 1, '2018-11-14 19:19:58'),
(86, 18, 'Staff', 'staff', 1, 1, 1, 1, '2018-06-22 05:23:31'),
(87, 18, 'Disable Staff', 'disable_staff', 1, 0, 0, 0, '2018-06-22 05:23:12'),
(88, 18, 'Staff Attendance', 'staff_attendance', 1, 1, 1, 0, '2018-06-22 05:23:10'),
(89, 14, 'Staff Attendance Report', 'staff_attendance_report', 1, 0, 0, 0, '2021-09-13 07:42:50'),
(90, 18, 'Staff Payroll', 'staff_payroll', 1, 1, 0, 1, '2018-06-22 05:22:51'),
(91, 14, 'Payroll Report', 'payroll_report', 1, 0, 0, 0, '2021-09-13 07:43:00'),
(102, 21, 'Calendar To Do List', 'calendar_to_do_list', 1, 1, 1, 1, '2018-06-22 05:24:41'),
(104, 10, 'Item Category', 'item_category', 1, 1, 1, 1, '2018-06-22 05:04:33'),
(108, 18, ' Approve Leave Request', 'approve_leave_request', 1, 1, 1, 1, '2018-07-02 04:47:41'),
(109, 18, 'Apply Leave', 'apply_leave', 1, 1, 0, 1, '2020-08-24 20:18:58'),
(110, 18, 'Leave Types', 'leave_types', 1, 1, 1, 1, '2018-07-02 04:47:56'),
(111, 18, 'Department', 'department', 1, 1, 1, 1, '2018-06-25 22:27:07'),
(112, 18, 'Designation', 'designation', 1, 1, 1, 1, '2018-06-25 22:27:07'),
(118, 22, 'Staff Role Count Widget', 'staff_role_count_widget', 1, 0, 0, 0, '2018-07-03 01:43:35'),
(126, 15, 'Users', 'users', 1, 0, 0, 0, '2021-09-22 01:13:59'),
(127, 18, 'Can See Other Users Profile', 'can_see_other_users_profile', 1, 0, 0, 0, '2018-07-03 03:12:29'),
(129, 18, 'Staff Timeline', 'staff_timeline', 0, 1, 0, 1, '2018-07-05 02:38:52'),
(130, 15, 'Backup', 'backup', 1, 1, 0, 1, '2018-07-08 22:47:17'),
(131, 15, 'Restore', 'restore', 1, 0, 0, 0, '2018-07-08 22:47:17'),
(132, 23, 'OPD Patient', 'opd_patient', 1, 1, 1, 1, '2018-12-20 04:07:26'),
(134, 23, 'Prescription', 'prescription', 1, 1, 1, 1, '2018-10-10 19:58:26'),
(135, 23, 'Visit', 'visit', 1, 1, 1, 1, '2021-09-17 02:09:58'),
(137, 23, 'OPD Timeline', 'opd_timeline', 1, 1, 1, 1, '2021-02-24 06:32:04'),
(138, 24, 'IPD Patients', 'ipd_patient', 1, 1, 1, 1, '2018-10-11 01:44:55'),
(139, 24, 'Discharged Patients', 'discharged_patients', 1, 1, 1, 1, '2021-02-24 06:57:17'),
(140, 24, 'Consultant Register', 'consultant_register', 1, 1, 1, 1, '2021-02-24 07:07:07'),
(142, 24, 'IPD Timeline', 'ipd_timeline', 1, 1, 1, 1, '2021-02-25 07:00:00'),
(143, 24, 'Charges', 'charges', 1, 1, 1, 1, '2018-10-10 19:58:26'),
(144, 24, 'Payment', 'payment', 1, 1, 0, 1, '2021-09-08 07:11:13'),
(146, 25, 'Medicine', 'medicine', 1, 1, 1, 1, '2018-10-10 19:58:26'),
(148, 25, 'Pharmacy Bill', 'pharmacy_bill', 1, 1, 1, 1, '2021-02-25 07:03:40'),
(149, 26, 'Pathology Test', 'pathology_test', 1, 1, 1, 1, '2021-02-25 07:06:32'),
(152, 27, 'Radiology Test', 'radiology_test', 1, 1, 1, 1, '2021-02-25 07:15:31'),
(153, 27, 'Radiology  Bill', 'radiology_bill', 1, 1, 1, 1, '2021-09-16 23:46:48'),
(155, 22, 'IPD Income Widget', 'ipd_income_widget', 1, 0, 0, 0, '2018-12-20 03:38:05'),
(156, 22, 'OPD Income Widget', 'opd_income_widget', 1, 0, 0, 0, '2018-12-20 03:38:15'),
(157, 22, 'Pharmacy Income Widget', 'pharmacy_income_widget', 1, 0, 0, 0, '2018-12-20 03:38:25'),
(158, 22, 'Pathology Income Widget', 'pathology_income_widget', 1, 0, 0, 0, '2018-12-20 03:38:37'),
(159, 22, 'Radiology Income Widget', 'radiology_income_widget', 1, 0, 0, 0, '2018-12-20 03:38:49'),
(161, 22, 'Blood Bank Income Widget', 'blood_bank_income_widget', 1, 0, 0, 0, '2018-12-20 03:39:13'),
(162, 22, 'Ambulance Income Widget', 'ambulance_income_widget', 1, 0, 0, 0, '2018-12-20 03:39:25'),
(165, 29, 'Ambulance Call', 'ambulance_call', 1, 1, 1, 1, '2018-10-26 22:07:51'),
(166, 29, 'Ambulance', 'ambulance', 1, 1, 1, 1, '2018-10-26 22:07:59'),
(168, 30, 'Blood Issue', 'blood_issue', 1, 1, 1, 1, '2018-10-26 22:50:15'),
(169, 30, 'Blood Donor', 'blood_donor', 1, 1, 1, 1, '2018-10-26 22:50:19'),
(170, 25, 'Medicine Category', 'medicine_category', 1, 1, 1, 1, '2018-10-25 00:40:24'),
(171, 27, 'Radiology Category', 'radiology_category', 1, 1, 1, 1, '2021-02-25 07:22:34'),
(173, 31, 'Organisation', 'organisation', 1, 1, 1, 1, '2018-10-25 00:40:24'),
(175, 26, 'Pathology Category', 'pathology_category', 1, 1, 1, 1, '2018-10-25 00:40:24'),
(176, 32, 'Hospital Charges', 'hospital_charges', 1, 1, 1, 1, '2021-09-13 01:59:30'),
(178, 14, 'IPD Report', 'ipd_report', 1, 0, 0, 0, '2018-12-12 04:39:24'),
(179, 14, 'Pharmacy Bill Report', 'pharmacy_bill_report', 1, 0, 0, 0, '2018-12-12 04:39:24'),
(180, 14, 'Pathology Patient Report', 'pathology_patient_report', 1, 0, 0, 0, '2018-12-12 04:39:24'),
(181, 14, 'Radiology Patient Report', 'radiology_patient_report', 1, 0, 0, 0, '2018-12-12 04:39:24'),
(182, 14, 'OT Report', 'ot_report', 1, 0, 0, 0, '2019-03-08 01:26:54'),
(183, 14, 'Blood Donor Report', 'blood_donor_report', 1, 0, 0, 0, '2019-03-08 01:26:54'),
(184, 14, 'Payroll Month Report', 'payroll_month_report', 1, 0, 0, 0, '2019-03-08 01:27:25'),
(185, 14, 'Payroll Report', 'payroll_report', 1, 0, 0, 0, '2019-03-08 01:27:35'),
(187, 14, 'User Log', 'user_log', 1, 0, 0, 0, '2018-12-12 04:39:24'),
(188, 14, 'Patient Login Credential', 'patient_login_credential', 1, 0, 0, 0, '2018-12-12 04:39:24'),
(189, 14, 'Email / SMS Log', 'email_sms_log', 1, 0, 0, 0, '2018-12-12 04:39:24'),
(190, 22, 'Yearly Income & Expense Chart', 'yearly_income_expense_chart', 1, 0, 0, 0, '2018-12-12 04:52:05'),
(191, 22, 'Monthly Income & Expense Chart', 'monthly_income_expense_chart', 1, 0, 0, 0, '2018-12-12 04:55:14'),
(192, 23, 'OPD Prescription Print Header Footer ', 'opd_prescription_print_header_footer', 1, 0, 1, 0, '2021-09-07 00:52:20'),
(196, 24, 'Bed', 'bed', 1, 1, 1, 1, '2018-12-12 05:16:01'),
(197, 24, 'IPD Prescription Print Header Footer', 'ipd_prescription_print_header_footer', 1, 0, 1, 0, '2021-09-07 01:56:49'),
(198, 24, 'Bed Status', 'bed_status', 1, 0, 0, 0, '2018-12-12 05:09:42'),
(200, 25, 'Medicine Bad Stock', 'medicine_bad_stock', 1, 1, 0, 1, '2018-12-17 19:42:46'),
(201, 25, 'Pharmacy Bill print Header Footer', 'pharmacy_bill_print_header_footer', 1, 0, 1, 0, '2021-09-10 07:11:18'),
(202, 30, 'Blood Stock', 'blood_stock', 1, 1, 0, 1, '2021-09-11 04:19:52'),
(203, 32, 'Charge Category', 'charge_category', 1, 1, 1, 1, '2018-12-12 05:49:38'),
(206, 14, 'TPA Report', 'tpa_report', 1, 0, 0, 0, '2019-03-08 01:19:25'),
(207, 14, 'Ambulance Report', 'ambulance_report', 1, 0, 0, 0, '2019-03-08 01:19:41'),
(208, 14, 'Discharge Patient Report', 'discharge_patient_report', 1, 0, 0, 0, '2019-03-08 01:19:55'),
(209, 14, 'Appointment Report', 'appointment_report', 1, 0, 0, 0, '2019-03-08 01:20:10'),
(210, 14, 'Transaction Report', 'transaction_report', 1, 0, 0, 0, '2019-03-08 01:27:35'),
(211, 14, 'Blood Issue Report', 'blood_issue_report', 1, 0, 0, 0, '2019-03-08 01:27:35'),
(212, 14, 'Income Report', 'income_report', 1, 0, 0, 0, '2019-03-08 01:27:35'),
(213, 14, 'Expense Report', 'expense_report', 1, 0, 0, 0, '2019-03-08 01:27:35'),
(214, 34, 'Birth Record', 'birth_record', 1, 1, 1, 1, '2018-06-22 05:06:02'),
(215, 34, 'Death Record', 'death_record', 1, 1, 1, 1, '2018-06-22 05:06:02'),
(218, 23, 'Move Patient in IPD', 'opd_move_patient_in_ipd', 1, 0, 0, 0, '2021-09-17 02:30:06'),
(219, 23, 'Manual Prescription', 'manual_prescription', 1, 0, 0, 0, '2019-09-22 23:22:06'),
(220, 24, 'Prescription ', 'ipd_prescription', 1, 1, 1, 1, '2019-09-23 19:29:27'),
(221, 23, 'Charges', 'opd_charges', 1, 1, 1, 1, '2019-09-22 23:28:03'),
(222, 23, 'Payment', 'opd_payment', 1, 1, 0, 1, '2021-09-08 06:14:17'),
(224, 25, 'Import Medicine', 'import_medicine', 1, 0, 0, 0, '2019-09-22 23:33:31'),
(225, 25, 'Medicine Purchase', 'medicine_purchase', 1, 1, 0, 1, '2021-10-02 10:29:02'),
(226, 25, 'Medicine Supplier', 'medicine_supplier', 1, 1, 1, 1, '2019-09-22 23:39:36'),
(227, 25, 'Medicine Dosage', 'medicine_dosage', 1, 1, 1, 1, '2019-09-22 23:47:16'),
(236, 36, 'Patient', 'patient', 1, 1, 1, 1, '2021-09-22 02:59:37'),
(237, 36, 'Enabled/Disabled', 'enabled_disabled', 1, 0, 0, 0, '2019-09-23 00:55:35'),
(238, 22, 'Notification Center', 'notification_center', 1, 0, 0, 0, '2019-09-23 22:18:33'),
(239, 36, 'Import', 'patient_import', 1, 0, 0, 0, '2019-10-03 19:50:26'),
(240, 34, 'Birth Print Header Footer', 'birth_print_header_footer', 1, 0, 1, 0, '2021-09-13 04:21:32'),
(242, 34, 'Death Print Header Footer', 'death_print_header_footer', 1, 0, 1, 0, '2021-09-13 04:21:38'),
(243, 26, 'Print Header Footer', 'pathology_print_header_footer', 1, 0, 1, 0, '2021-09-17 01:07:21'),
(244, 27, 'Print Header Footer', 'radiology_print_header_footer', 1, 0, 1, 0, '2021-09-17 00:54:43'),
(246, 30, 'Print Header Footer', 'bloodbank_print_header_footer', 1, 0, 0, 0, '2021-10-07 09:36:58'),
(247, 29, 'Print Header Footer', 'ambulance_print_header_footer', 1, 1, 1, 1, '2019-10-03 20:15:03'),
(248, 24, 'IPD Bill Print Header Footer', 'ipd_bill_print_header_footer', 1, 0, 1, 0, '2021-09-07 01:57:00'),
(249, 18, 'Print Payslip Header Footer', 'print_payslip_header_footer', 1, 1, 1, 1, '2019-10-03 21:01:33'),
(250, 14, 'Income Group Report', 'income_group_report', 1, 0, 0, 0, '2020-08-12 00:22:52'),
(251, 14, 'Expense Group Report', 'expense_group_report', 1, 0, 0, 0, '2019-10-03 22:45:56'),
(253, 14, 'Inventory Stock Report', 'inventory_stock_report', 1, 0, 0, 0, '2019-10-03 23:50:31'),
(254, 14, 'Inventory Item Report', 'add_item_report', 1, 0, 0, 0, '2019-10-03 23:53:22'),
(255, 14, 'Inventory Issue Report', 'issue_inventory_report', 1, 0, 0, 0, '2019-10-03 23:54:40'),
(256, 14, 'Expiry Medicine Report', 'expiry_medicine_report', 1, 0, 0, 0, '2019-10-04 00:30:11'),
(257, 26, 'Pathology Bill', 'pathology_bill', 1, 1, 1, 1, '2021-02-25 07:28:10'),
(258, 14, 'Birth Report', 'birth_report', 1, 0, 0, 0, '2019-10-13 21:42:35'),
(259, 14, 'Death Report', 'death_report', 1, 0, 0, 0, '2019-10-13 21:43:56'),
(260, 26, 'Pathology Unit', 'pathology_unit', 1, 1, 1, 1, '2020-07-21 19:43:49'),
(261, 27, 'Radiology Unit', 'radiology_unit', 1, 1, 1, 1, '2020-07-21 19:44:47'),
(262, 27, 'Radiology Parameter', 'radiology_parameter', 1, 1, 1, 1, '2020-07-21 19:50:28'),
(263, 26, 'Pathology Parameter', 'pathology_parameter', 1, 1, 1, 1, '2020-07-21 19:50:28'),
(264, 32, 'Charge Type', 'charge_type', 1, 1, 0, 1, '2020-07-21 22:39:44'),
(265, 14, 'OPD Balance Report', 'opd_balance_report', 1, 0, 0, 0, '2020-07-27 20:33:34'),
(266, 14, 'IPD Balance Report', 'ipd_balance_report', 1, 0, 0, 0, '2020-07-27 20:33:34'),
(267, 15, 'Symptoms Type', 'symptoms_type', 1, 1, 1, 1, '2021-09-14 03:06:22'),
(269, 37, 'Live Consultation', 'live_consultation', 1, 1, 0, 1, '2020-08-13 00:49:27'),
(270, 37, 'Live Meeting', 'live_meeting', 1, 1, 0, 1, '2020-08-13 00:49:27'),
(271, 14, 'Live Consultation Report', 'live_consultation_report', 1, 0, 0, 0, '2021-09-13 07:41:19'),
(272, 14, 'Live Meeting Report', 'live_meeting_report', 1, 0, 0, 0, '2021-09-13 07:41:14'),
(273, 37, 'Setting', 'setting', 1, 0, 1, 0, '2020-08-13 01:33:28'),
(274, 15, 'Language Switcher', 'language_switcher', 1, 0, 0, 0, '2020-08-20 23:18:53'),
(279, 15, 'Symptoms Head', 'symptoms_head', 1, 1, 1, 1, '2021-09-14 03:06:27'),
(280, 18, 'Specialist', 'specialist', 1, 1, 1, 1, '2019-10-03 15:31:33'),
(281, 22, 'General Income Widget', 'general_income_widget', 1, 0, 0, 0, '2018-12-19 22:08:05'),
(282, 22, 'Expenses Widget', 'expenses_widget', 1, 0, 0, 0, '2018-12-19 22:08:05'),
(283, 38, 'Referral Category', 'referral_category', 1, 1, 1, 1, '2021-06-11 08:24:41'),
(284, 38, 'Referral Commission', 'referral_commission', 1, 1, 1, 1, '2021-06-11 08:24:41'),
(285, 38, 'Referral Person', 'referral_person', 1, 1, 1, 1, '2021-06-11 08:25:21'),
(286, 38, 'Referral Payment', 'referral_payment', 1, 1, 1, 1, '2021-06-11 08:25:21'),
(287, 15, 'Prefix Setting', 'prefix_setting', 1, 0, 1, 0, '2021-06-12 02:16:10'),
(288, 15, 'Captcha Setting', 'captcha_setting', 1, 0, 1, 0, '2021-06-12 03:13:53'),
(289, 32, 'Tax Category', 'tax_category', 1, 1, 1, 1, '2021-06-12 03:46:39'),
(290, 32, 'Unit Type', 'unit_type', 1, 1, 1, 1, '2021-06-12 03:46:39'),
(291, 25, 'Dosage Interval', 'dosage_interval', 1, 1, 1, 1, '2021-06-12 05:45:37'),
(292, 25, 'Dosage Duration', 'dosage_duration', 1, 1, 1, 1, '2021-06-12 05:45:37'),
(293, 30, 'Blood Bank Product', 'blood_bank_product', 1, 1, 1, 1, '2021-06-12 06:21:23'),
(294, 39, 'Slot', 'online_appointment_slot', 1, 1, 1, 1, '2021-09-14 06:34:31'),
(295, 39, 'Doctor Shift', 'online_appointment_doctor_shift', 1, 0, 1, 0, '2021-06-12 07:13:48'),
(296, 39, 'Shift', 'online_appointment_shift', 1, 1, 1, 1, '2021-06-12 06:54:25'),
(297, 39, 'Doctor Wise Appointment', 'doctor_wise_appointment', 1, 0, 0, 0, '2021-10-07 07:15:39'),
(298, 39, 'Patient Queue', 'patient_queue', 1, 0, 0, 0, '2021-10-07 07:15:42'),
(299, 23, 'OPD Medication', 'opd_medication', 1, 1, 1, 1, '2021-06-15 01:30:12'),
(300, 24, 'IPD Medication', 'ipd_medication', 1, 1, 1, 1, '2021-06-15 01:30:12'),
(301, 24, 'Bed History', 'bed_history', 1, 0, 0, 0, '2021-06-15 01:30:12'),
(302, 30, 'Blood Bank Components', 'blood_bank_components', 1, 1, 0, 1, '2021-06-15 06:16:48'),
(303, 23, 'Operation Theatre', 'opd_operation_theatre', 1, 1, 1, 1, '2021-09-08 04:19:13'),
(304, 23, 'Lab Investigation', 'opd_lab_investigation', 1, 0, 0, 0, '2021-09-07 01:06:10'),
(305, 23, 'Patient Discharge', 'opd_patient_discharge', 1, 0, 1, 0, '2021-09-07 01:09:16'),
(306, 23, 'Patient Discharge Revert', 'opd_patient_discharge_revert', 1, 0, 0, 0, '2021-09-07 01:09:38'),
(307, 23, 'Treatment History', 'opd_treatment_history', 1, 0, 0, 0, '2021-09-07 01:19:05'),
(308, 24, 'Lab Investigation', 'ipd_lab_investigation', 1, 0, 0, 0, '2021-09-07 02:15:59'),
(309, 24, 'Patient Discharge', 'ipd_patient_discharge', 1, 0, 1, 0, '2021-09-07 03:38:20'),
(310, 24, 'Patient Discharge Revert', 'ipd_patient_discharge_revert', 1, 0, 0, 0, '2021-09-07 03:44:54'),
(311, 30, 'Issue Component', 'issue_component', 1, 1, 1, 1, '2021-09-07 03:51:53'),
(312, 26, ' Add/Edit Collection Person', 'pathology_add_edit_collection_person', 1, 0, 1, 0, '2021-09-17 01:36:13'),
(313, 25, 'Partial Payment', 'pharmacy_partial_payment', 1, 1, 0, 1, '2021-09-07 06:40:15'),
(314, 26, 'Partial Payment', 'pathology_partial_payment', 1, 1, 0, 1, '2021-09-07 08:04:33'),
(315, 27, 'Partial Payment', 'radiology_partial_payment', 1, 1, 0, 1, '2021-09-07 08:08:15'),
(316, 28, 'Partial Payment', 'radiology_partial_payment', 1, 1, 0, 1, '2021-09-07 08:09:02'),
(317, 30, 'Partial Payment', 'blood_bank_partial_payment', 1, 1, 0, 1, '2021-09-07 08:17:22'),
(318, 29, 'Partial Payment', 'ambulance_partial_payment', 1, 1, 0, 1, '2021-09-07 08:18:10'),
(319, 23, 'Checkup', 'checkup', 1, 1, 1, 1, '2021-09-17 02:10:33'),
(320, 23, 'Print Bill', 'opd_print_bill', 1, 0, 0, 0, '2021-09-08 04:39:27'),
(321, 23, 'Live Consult', 'opd_live_consult', 1, 0, 0, 0, '2021-09-08 06:23:31'),
(322, 24, 'Nurse Note', 'nurse_note', 1, 1, 1, 1, '2021-09-08 06:50:07'),
(323, 24, 'Bed Type', 'bed_type', 1, 1, 1, 1, '2021-09-09 01:36:39'),
(324, 24, 'Bed Group', 'bed_group', 1, 1, 1, 1, '2021-09-09 01:37:08'),
(325, 24, 'Floor', 'floor', 1, 1, 1, 1, '2021-09-09 01:38:35'),
(326, 24, 'Operation Theatre', 'ipd_operation_theatre', 1, 1, 1, 1, '2021-09-09 04:08:14'),
(327, 24, 'Live Consult', 'ipd_live_consultation', 1, 0, 0, 0, '2021-09-09 04:35:26'),
(329, 24, 'Treatment History', 'ipd_treatment_history', 1, 0, 0, 0, '2021-09-07 02:15:59'),
(330, 41, 'OPD Billing', 'opd_billing', 1, 0, 0, 0, '2021-09-09 06:03:14'),
(331, 41, 'OPD Billing Payment', 'opd_billing_payment', 1, 1, 0, 0, '2021-09-09 06:40:36'),
(332, 41, 'IPD Billing', 'ipd_billing', 1, 0, 0, 0, '2021-09-09 06:22:26'),
(333, 41, 'IPD Billing Payment', 'ipd_billing_payment', 1, 1, 0, 0, '2021-09-09 06:23:03'),
(334, 41, 'Pharmacy Billing', 'pharmacy_billing', 1, 0, 0, 0, '2021-09-09 06:23:03'),
(335, 41, 'Pharmacy Billing Payment', 'pharmacy_billing_payment', 1, 1, 0, 0, '2021-09-09 06:23:03'),
(336, 41, 'Pathology Billing', 'pathology_billing', 1, 0, 0, 0, '2021-09-09 06:23:03'),
(337, 41, 'Pathology Billing Payment', 'pathology_billing_payment', 1, 1, 0, 0, '2021-09-09 06:23:03'),
(338, 41, 'Radiology Billing', 'radiology_billing', 1, 0, 0, 0, '2021-09-09 06:23:03'),
(339, 41, 'Radiology Billing Payment', 'radiology_billing_payment', 1, 1, 0, 0, '2021-09-09 06:23:03'),
(340, 41, 'Blood Bank Billing', 'blood_bank_billing', 1, 0, 0, 0, '2021-09-09 06:23:03'),
(341, 41, 'Blood Bank Billing Payment', 'blood_bank_billing_payment', 1, 1, 0, 0, '2021-09-09 06:23:03'),
(342, 41, 'Ambulance Billing', 'ambulance_billing', 1, 0, 0, 0, '2021-09-09 06:23:03'),
(343, 41, 'Ambulance Billing Payment', 'ambulance_billing_payment', 1, 1, 0, 0, '2021-09-09 06:23:03'),
(344, 41, 'Generate Bill', 'generate_bill', 1, 0, 0, 0, '2021-09-10 02:06:09'),
(345, 41, 'Generate Discharge Card', 'generate_discharge_card', 1, 0, 0, 0, '2021-09-09 06:23:03'),
(346, 40, 'Online Appointment', 'online_appointment', 1, 0, 0, 0, '2021-09-09 07:45:17'),
(347, 31, 'TPA Charges ', 'tpa_charges', 1, 0, 1, 1, '2018-10-25 00:40:24'),
(348, 15, 'System Notification Setting', 'system_notification_setting', 1, 0, 1, 0, '2018-07-05 03:38:41'),
(349, 14, 'All Transaction Report', 'all_transaction_report', 1, 0, 0, 0, '2021-09-13 07:59:20'),
(350, 14, 'Patient Visit Report', 'patient_visit_report', 1, 0, 0, 0, '2019-10-03 23:53:22'),
(351, 14, 'Patient Bill Report', 'patient_bill_report', 1, 0, 0, 0, '2019-10-03 22:45:56'),
(352, 14, 'Referral Report', 'referral_report', 1, 0, 0, 0, '2019-10-03 22:45:56'),
(353, 27, 'Add/Edit Collection Person', 'radiology_add_edit_collection_person', 1, 0, 1, 0, '2021-09-17 01:36:41'),
(354, 27, 'Add/Edit  Report', 'radiology_add_edit_report', 1, 0, 1, 0, '2021-09-17 01:36:50'),
(355, 26, 'Add/Edit Report', 'pathology_add_edit_report', 1, 0, 1, 0, '2021-09-17 01:36:24'),
(362, 42, 'Generate Certificate', 'generate_certificate', 1, 0, 0, 0, '2021-09-20 22:18:25'),
(363, 42, 'Certificate', 'certificate', 1, 1, 1, 1, '2021-09-20 22:18:25'),
(364, 42, 'Generate Staff ID Card', 'generate_staff_id_card', 1, 0, 0, 0, '2021-09-20 22:26:38'),
(365, 42, 'Staff ID Card', 'staff_id_card', 1, 1, 1, 1, '2021-09-20 22:26:09'),
(366, 42, 'Generate Patient ID Card', 'generate_patient_id_card', 1, 0, 0, 0, '2021-09-21 04:43:54'),
(367, 42, 'Patient ID Card', 'patient_id_card', 1, 1, 1, 1, '2021-09-20 22:24:38'),
(369, 14, 'Component Issue Report', 'component_issue_report', 1, 0, 0, 0, '2019-03-08 01:27:35'),
(370, 14, 'Audit Trail Report', 'audit_trail_report', 1, 0, 0, 0, '2021-09-28 06:38:22'),
(371, 43, 'Chat', 'chat', 1, 0, 0, 0, '2021-10-07 10:35:15'),
(372, 15, 'Custom Fields', 'custom_fields', 1, 0, 0, 0, '2021-10-29 07:41:26'),
(373, 14, 'Daily Transaction Report', 'daily_transaction_report', 1, 0, 0, 0, '2021-10-29 07:42:08'),
(374, 15, 'Operation', 'operation', 1, 1, 1, 1, '2021-10-29 07:45:14'),
(375, 15, 'Operation Category', 'operation_category', 1, 1, 1, 1, '2021-10-29 07:45:14');

;
--
-- Dumping data for table `roles_permissions`
--
INSERT INTO `roles_permissions` (`id`, `role_id`, `perm_cat_id`, `can_view`, `can_add`, `can_edit`, `can_delete`, `created_at`) VALUES
(1, 1, 346, 1, 0, 0, 0, '2021-09-15 02:19:21'),
(2, 1, 80, 1, 1, 1, 1, '2021-09-15 02:31:34'),
(3, 1, 81, 1, 1, 1, 1, '2021-09-15 02:31:34'),
(4, 1, 82, 1, 1, 1, 1, '2021-09-15 02:31:34'),
(5, 1, 83, 1, 1, 1, 1, '2021-09-15 02:31:34'),
(6, 1, 84, 1, 1, 1, 1, '2021-09-15 02:31:34'),
(7, 1, 85, 1, 1, 1, 1, '2021-09-15 02:31:34'),
(8, 1, 204, 1, 1, 1, 1, '2021-09-15 02:22:47'),
(9, 1, 205, 1, 0, 0, 0, '2021-09-15 02:20:15'),
(10, 1, 216, 1, 0, 0, 0, '2021-09-15 02:20:15'),
(11, 1, 217, 1, 0, 0, 0, '2021-09-15 02:20:15'),
(14, 1, 237, 1, 0, 0, 0, '2021-09-15 02:25:31'),
(15, 1, 239, 1, 0, 0, 0, '2021-09-15 02:25:31'),
(16, 1, 214, 1, 1, 1, 1, '2021-09-15 02:35:14'),
(17, 1, 215, 1, 1, 1, 1, '2021-09-15 02:35:14'),
(18, 1, 240, 1, 0, 1, 0, '2021-09-15 02:35:14'),
(19, 1, 242, 1, 0, 1, 0, '2021-09-15 02:35:14'),
(36, 1, 48, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(37, 1, 89, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(38, 1, 91, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(39, 1, 178, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(40, 1, 179, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(41, 1, 180, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(42, 1, 181, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(43, 1, 182, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(44, 1, 183, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(45, 1, 184, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(46, 1, 185, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(47, 1, 187, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(48, 1, 188, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(49, 1, 189, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(50, 1, 206, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(51, 1, 207, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(52, 1, 208, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(53, 1, 209, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(54, 1, 210, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(55, 1, 211, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(56, 1, 212, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(57, 1, 213, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(58, 1, 250, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(59, 1, 251, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(60, 1, 253, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(61, 1, 254, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(62, 1, 255, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(63, 1, 256, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(64, 1, 258, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(65, 1, 259, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(66, 1, 265, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(67, 1, 266, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(68, 1, 271, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(69, 1, 272, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(70, 1, 349, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(71, 1, 350, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(72, 1, 351, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(73, 1, 352, 1, 0, 0, 0, '2021-09-15 18:37:59'),
(78, 1, 12, 1, 1, 1, 1, '2021-09-17 21:55:07'),
(79, 1, 13, 1, 1, 1, 1, '2021-09-17 21:55:07'),
(81, 1, 134, 1, 1, 1, 1, '2021-10-07 04:54:53'),
(84, 1, 192, 1, 0, 1, 0, '2021-10-07 04:54:53'),
(105, 1, 140, 1, 1, 1, 1, '2021-10-07 04:55:23'),
(106, 1, 142, 1, 1, 1, 1, '2021-10-07 04:55:23'),
(114, 1, 300, 1, 1, 1, 1, '2021-09-16 22:16:20'),
(117, 1, 309, 1, 0, 1, 0, '2021-09-16 22:16:20'),
(119, 1, 322, 1, 1, 1, 1, '2021-09-16 22:16:20'),
(125, 1, 170, 1, 1, 1, 1, '2021-09-17 19:38:24'),
(127, 1, 201, 1, 0, 1, 0, '2021-09-15 23:45:28'),
(131, 1, 227, 1, 1, 1, 1, '2021-09-17 19:10:09'),
(132, 1, 291, 1, 1, 1, 1, '2021-09-17 19:10:09'),
(133, 1, 292, 1, 1, 1, 1, '2021-09-17 19:10:09'),
(142, 1, 317, 1, 1, 0, 1, '2021-09-15 20:15:33'),
(143, 1, 269, 1, 1, 0, 1, '2021-09-15 20:16:52'),
(144, 1, 270, 1, 1, 0, 1, '2021-09-15 20:16:52'),
(149, 1, 54, 1, 0, 1, 0, '2021-10-07 00:37:31'),
(150, 1, 56, 1, 0, 1, 0, '2021-10-07 00:37:31'),
(151, 1, 57, 1, 0, 1, 0, '2021-09-15 20:53:19'),
(152, 1, 58, 1, 0, 1, 0, '2021-09-15 20:53:19'),
(153, 1, 59, 1, 0, 1, 0, '2021-09-15 20:53:19'),
(154, 1, 60, 1, 0, 1, 0, '2021-09-15 20:53:19'),
(155, 1, 126, 1, 0, 0, 0, '2021-09-15 20:53:19'),
(156, 1, 130, 1, 1, 0, 1, '2021-09-15 20:53:19'),
(157, 1, 131, 1, 0, 0, 0, '2021-09-15 20:54:53'),
(158, 1, 267, 1, 1, 1, 1, '2021-09-15 20:54:53'),
(159, 1, 274, 1, 0, 0, 0, '2021-09-15 20:54:53'),
(160, 1, 279, 1, 1, 1, 1, '2021-09-15 20:54:53'),
(161, 1, 287, 1, 0, 1, 0, '2021-09-15 20:54:53'),
(162, 1, 288, 1, 0, 1, 0, '2021-09-15 20:54:53'),
(163, 1, 348, 1, 0, 1, 0, '2021-09-15 20:54:53'),
(164, 1, 61, 1, 1, 0, 1, '2021-10-07 04:57:12'),
(165, 1, 62, 1, 1, 0, 1, '2021-10-07 04:57:12'),
(166, 1, 63, 1, 1, 0, 1, '2021-10-07 04:57:12'),
(167, 1, 64, 1, 1, 1, 1, '2021-10-07 04:57:12'),
(168, 1, 65, 1, 1, 1, 1, '2021-10-07 04:57:12'),
(169, 1, 66, 1, 1, 1, 1, '2021-10-07 04:57:12'),
(170, 1, 67, 1, 1, 1, 1, '2021-10-07 04:57:12'),
(171, 1, 43, 1, 1, 1, 1, '2021-09-15 21:54:11'),
(172, 1, 44, 1, 0, 0, 0, '2021-09-15 21:53:24'),
(175, 1, 283, 1, 1, 1, 1, '2021-09-17 22:22:19'),
(176, 1, 284, 1, 1, 1, 1, '2021-09-17 22:22:19'),
(177, 1, 285, 1, 1, 1, 1, '2021-09-17 22:22:19'),
(178, 1, 286, 1, 1, 1, 1, '2021-09-17 22:22:19'),
(181, 1, 146, 1, 1, 1, 1, '2021-09-17 02:03:26'),
(182, 1, 148, 1, 1, 1, 1, '2021-09-17 02:03:26'),
(184, 1, 86, 1, 1, 1, 1, '2021-09-17 23:02:51'),
(192, 1, 127, 1, 0, 0, 0, '2021-09-16 00:46:49'),
(193, 1, 118, 1, 0, 0, 0, '2021-09-16 00:59:08'),
(194, 1, 152, 1, 1, 1, 1, '2021-09-16 23:30:15'),
(195, 1, 153, 1, 1, 1, 1, '2021-09-16 19:14:09'),
(197, 1, 354, 1, 0, 1, 0, '2021-09-17 19:42:16'),
(199, 1, 261, 1, 1, 1, 1, '2021-09-17 19:42:16'),
(200, 1, 262, 1, 1, 1, 1, '2021-09-17 19:42:16'),
(201, 1, 315, 1, 1, 0, 1, '2021-09-17 19:42:16'),
(202, 1, 244, 1, 0, 1, 0, '2021-09-16 20:29:17'),
(221, 1, 138, 1, 1, 1, 1, '2021-10-07 04:55:23'),
(222, 1, 139, 1, 1, 1, 1, '2021-10-07 04:55:23'),
(223, 1, 143, 1, 1, 1, 1, '2021-10-07 04:55:23'),
(224, 1, 144, 1, 1, 0, 1, '2021-10-07 04:55:23'),
(226, 1, 197, 1, 0, 1, 0, '2021-09-17 02:01:37'),
(228, 1, 248, 1, 0, 1, 0, '2021-10-07 04:55:23'),
(229, 1, 301, 1, 0, 0, 0, '2021-09-16 22:16:20'),
(230, 1, 308, 1, 0, 0, 0, '2021-09-16 22:16:20'),
(236, 1, 149, 1, 1, 1, 1, '2021-10-22 00:28:29'),
(237, 1, 175, 1, 1, 1, 1, '2021-10-22 00:28:29'),
(238, 1, 243, 1, 0, 1, 0, '2021-10-22 00:28:29'),
(239, 1, 257, 1, 1, 1, 1, '2021-10-22 00:28:29'),
(243, 1, 314, 1, 1, 0, 1, '2021-10-22 00:28:29'),
(245, 1, 310, 1, 0, 0, 0, '2021-09-16 22:29:09'),
(247, 1, 355, 1, 0, 1, 0, '2021-10-22 00:28:29'),
(248, 1, 260, 1, 1, 1, 1, '2021-10-22 00:28:29'),
(249, 1, 263, 1, 1, 1, 1, '2021-10-22 00:28:29'),
(250, 1, 312, 1, 0, 1, 0, '2021-10-22 00:28:29'),
(254, 1, 135, 1, 1, 1, 1, '2021-10-07 04:54:53'),
(255, 1, 137, 1, 1, 1, 1, '2021-10-07 04:54:53'),
(257, 1, 219, 1, 0, 0, 0, '2021-09-17 01:09:11'),
(258, 1, 221, 1, 1, 1, 1, '2021-09-18 00:55:57'),
(259, 1, 222, 1, 1, 0, 1, '2021-09-17 01:13:33'),
(260, 1, 299, 1, 1, 1, 1, '2021-09-17 01:14:24'),
(261, 1, 303, 1, 1, 1, 1, '2021-09-17 01:17:48'),
(262, 1, 304, 1, 0, 0, 0, '2021-09-17 01:21:20'),
(263, 1, 305, 1, 0, 1, 0, '2021-09-17 01:22:28'),
(264, 1, 306, 1, 0, 0, 0, '2021-09-17 01:22:43'),
(265, 1, 307, 1, 0, 0, 0, '2021-09-17 01:23:28'),
(266, 1, 319, 1, 1, 1, 1, '2021-10-07 05:01:26'),
(274, 1, 220, 1, 1, 1, 1, '2021-09-17 02:02:20'),
(275, 1, 326, 1, 1, 1, 1, '2021-09-17 18:09:51'),
(276, 1, 200, 1, 1, 0, 1, '2021-09-17 18:59:44'),
(277, 1, 225, 1, 1, 1, 1, '2021-09-17 19:10:09'),
(278, 1, 226, 1, 1, 1, 1, '2021-09-17 19:10:09'),
(279, 1, 224, 1, 0, 0, 0, '2021-09-17 19:38:24'),
(280, 1, 313, 1, 1, 0, 1, '2021-09-17 19:39:06'),
(281, 1, 171, 1, 1, 1, 1, '2021-09-17 19:46:07'),
(282, 1, 353, 1, 0, 1, 0, '2021-09-17 19:46:38'),
(283, 1, 168, 1, 1, 1, 1, '2021-09-17 20:14:24'),
(284, 1, 169, 1, 1, 1, 1, '2021-09-17 20:16:16'),
(285, 1, 311, 1, 1, 1, 1, '2021-09-17 20:24:00'),
(286, 1, 246, 1, 1, 1, 1, '2021-09-17 20:26:44'),
(287, 1, 202, 1, 1, 0, 1, '2021-09-17 20:30:46'),
(288, 1, 293, 1, 1, 1, 1, '2021-09-17 20:30:46'),
(289, 1, 302, 1, 1, 0, 1, '2021-09-17 20:30:46'),
(290, 1, 173, 1, 1, 1, 1, '2021-09-17 20:36:23'),
(291, 1, 347, 1, 0, 1, 1, '2021-09-17 20:36:23'),
(292, 1, 273, 1, 0, 1, 0, '2021-09-17 21:43:50'),
(293, 1, 9, 1, 1, 1, 1, '2021-09-17 21:47:50'),
(294, 1, 10, 1, 1, 1, 1, '2021-09-17 21:47:50'),
(295, 1, 176, 1, 1, 1, 1, '2021-09-20 23:45:51'),
(296, 1, 102, 1, 1, 1, 1, '2021-10-07 05:04:58'),
(297, 1, 31, 1, 1, 0, 1, '2021-10-07 00:40:13'),
(298, 1, 32, 1, 1, 1, 1, '2021-09-17 22:47:43'),
(299, 1, 33, 1, 1, 1, 1, '2021-09-17 22:47:43'),
(300, 1, 34, 1, 1, 1, 1, '2021-09-17 22:47:43'),
(301, 1, 35, 1, 1, 1, 1, '2021-09-17 22:47:43'),
(302, 1, 104, 1, 1, 1, 1, '2021-09-17 22:47:43'),
(303, 1, 87, 1, 0, 0, 0, '2021-09-17 23:01:48'),
(304, 1, 88, 1, 1, 1, 0, '2021-09-17 23:33:38'),
(305, 1, 90, 1, 1, 0, 1, '2021-09-17 23:34:45'),
(306, 1, 108, 1, 1, 1, 1, '2021-09-17 23:37:46'),
(307, 1, 109, 1, 1, 0, 1, '2021-09-17 23:39:39'),
(308, 1, 110, 1, 1, 1, 1, '2021-10-07 04:56:43'),
(309, 1, 111, 1, 1, 1, 1, '2021-10-07 04:56:43'),
(310, 1, 112, 1, 1, 1, 1, '2021-10-07 04:56:43'),
(311, 1, 249, 1, 1, 1, 1, '2021-10-07 04:56:43'),
(313, 1, 203, 1, 1, 1, 1, '2021-09-17 23:08:50'),
(314, 1, 264, 1, 1, 0, 1, '2021-09-17 23:08:50'),
(315, 1, 289, 1, 1, 1, 1, '2021-09-17 23:08:50'),
(316, 1, 290, 1, 1, 1, 1, '2021-09-17 23:08:50'),
(317, 1, 165, 1, 1, 1, 1, '2021-09-17 23:23:51'),
(318, 1, 166, 1, 1, 1, 1, '2021-09-17 23:23:51'),
(319, 1, 247, 1, 1, 1, 1, '2021-09-17 23:23:51'),
(320, 1, 318, 1, 1, 0, 1, '2021-09-17 23:23:51'),
(324, 2, 237, 1, 0, 0, 0, '2021-09-18 01:01:56'),
(327, 2, 135, 1, 1, 1, 0, '2021-10-07 01:01:51'),
(334, 2, 221, 1, 1, 1, 1, '2021-09-18 01:25:50'),
(335, 2, 222, 1, 1, 0, 1, '2021-09-18 01:26:52'),
(336, 2, 299, 1, 0, 0, 0, '2021-10-07 01:01:51'),
(337, 2, 303, 1, 0, 0, 0, '2021-10-07 01:01:51'),
(339, 2, 305, 1, 0, 1, 0, '2021-09-18 01:38:56'),
(341, 2, 307, 1, 0, 0, 0, '2021-09-18 01:43:41'),
(343, 2, 320, 1, 0, 0, 0, '2021-09-18 01:44:37'),
(346, 2, 138, 1, 1, 1, 0, '2021-10-07 01:02:47'),
(350, 2, 143, 1, 1, 1, 1, '2021-09-19 23:54:42'),
(351, 2, 144, 1, 1, 0, 1, '2021-09-19 23:54:42'),
(354, 2, 329, 1, 0, 0, 0, '2021-09-18 02:23:47'),
(356, 2, 326, 1, 0, 0, 0, '2021-10-07 05:33:02'),
(357, 3, 132, 1, 1, 1, 1, '2021-09-21 20:39:45'),
(358, 3, 134, 1, 1, 1, 1, '2021-09-19 19:30:16'),
(362, 3, 135, 1, 1, 1, 1, '2021-09-19 19:45:00'),
(363, 3, 137, 1, 1, 1, 1, '2021-09-19 19:45:00'),
(364, 3, 192, 1, 0, 1, 0, '2021-09-19 19:46:00'),
(372, 1, 295, 1, 0, 1, 0, '2021-10-07 04:56:29'),
(373, 3, 218, 1, 0, 0, 0, '2021-09-19 21:47:53'),
(374, 3, 219, 1, 0, 0, 0, '2021-09-19 21:48:21'),
(375, 3, 221, 1, 1, 1, 1, '2021-09-19 21:48:54'),
(376, 3, 222, 1, 1, 0, 1, '2021-09-19 21:51:36'),
(377, 3, 299, 1, 1, 1, 1, '2021-09-19 21:53:11'),
(378, 3, 303, 1, 1, 1, 1, '2021-09-19 22:05:35'),
(379, 2, 139, 1, 1, 1, 0, '2021-10-07 01:02:47'),
(380, 3, 304, 1, 0, 0, 0, '2021-09-19 22:21:44'),
(382, 3, 305, 1, 0, 1, 0, '2021-09-19 22:23:53'),
(384, 2, 198, 1, 0, 0, 0, '2021-09-19 22:24:26'),
(386, 2, 300, 1, 1, 1, 1, '2021-09-19 23:54:42'),
(387, 2, 301, 1, 0, 0, 0, '2021-09-19 22:24:26'),
(388, 2, 308, 1, 0, 0, 0, '2021-09-19 22:24:26'),
(389, 2, 309, 1, 0, 0, 0, '2021-09-19 22:24:26'),
(391, 2, 323, 1, 1, 1, 1, '2021-09-19 23:54:42'),
(392, 2, 324, 1, 1, 1, 1, '2021-09-19 23:54:42'),
(393, 2, 325, 1, 1, 1, 1, '2021-09-19 23:54:42'),
(394, 3, 306, 1, 0, 0, 0, '2021-09-19 22:24:51'),
(395, 3, 307, 1, 0, 0, 0, '2021-09-19 22:26:27'),
(396, 3, 319, 1, 1, 1, 1, '2021-09-19 22:27:25'),
(397, 3, 320, 1, 0, 0, 0, '2021-09-19 22:38:28'),
(398, 3, 321, 1, 0, 0, 0, '2021-09-19 22:46:51'),
(399, 3, 138, 1, 1, 1, 1, '2021-09-19 22:47:05'),
(400, 3, 139, 1, 1, 1, 1, '2021-09-19 22:50:25'),
(401, 3, 140, 1, 1, 1, 1, '2021-09-19 22:51:13'),
(402, 3, 142, 1, 1, 1, 1, '2021-09-19 22:51:13'),
(403, 3, 143, 1, 1, 1, 1, '2021-09-19 22:51:13'),
(404, 3, 144, 1, 1, 0, 1, '2021-09-19 22:52:59'),
(405, 3, 196, 1, 1, 1, 1, '2021-09-19 22:56:19'),
(406, 3, 197, 1, 0, 1, 0, '2021-09-19 22:57:00'),
(407, 3, 198, 1, 0, 0, 0, '2021-09-19 22:57:21'),
(408, 3, 220, 1, 1, 1, 1, '2021-09-19 22:57:21'),
(409, 3, 248, 1, 0, 1, 0, '2021-09-19 22:58:10'),
(410, 3, 300, 1, 1, 1, 1, '2021-09-19 22:58:10'),
(411, 3, 301, 1, 0, 0, 0, '2021-09-19 22:59:15'),
(412, 3, 308, 1, 0, 0, 0, '2021-09-19 22:59:50'),
(413, 3, 309, 1, 0, 1, 0, '2021-09-19 23:00:17'),
(414, 3, 310, 1, 0, 0, 0, '2021-09-19 23:00:37'),
(415, 3, 322, 1, 1, 1, 1, '2021-09-19 23:01:22'),
(416, 3, 323, 1, 1, 1, 1, '2021-09-19 23:02:41'),
(417, 3, 324, 1, 1, 1, 1, '2021-09-19 23:02:41'),
(418, 3, 325, 1, 1, 1, 1, '2021-09-19 23:02:41'),
(419, 3, 326, 1, 1, 1, 1, '2021-09-19 23:03:57'),
(420, 3, 327, 1, 0, 0, 0, '2021-09-19 23:10:25'),
(421, 3, 329, 1, 0, 0, 0, '2021-09-19 23:10:25'),
(422, 3, 146, 1, 0, 0, 0, '2021-09-21 21:58:29'),
(424, 2, 327, 1, 0, 0, 0, '2021-09-19 23:14:27'),
(425, 3, 236, 1, 1, 1, 1, '2021-10-07 02:00:54'),
(433, 3, 226, 1, 0, 0, 0, '2021-09-20 19:02:48'),
(435, 3, 291, 1, 0, 0, 0, '2021-09-20 19:02:48'),
(436, 3, 292, 1, 0, 0, 0, '2021-09-20 19:02:48'),
(438, 3, 149, 1, 0, 0, 0, '2021-10-07 01:50:27'),
(444, 3, 312, 1, 0, 0, 0, '2021-10-07 01:50:27'),
(447, 2, 149, 1, 0, 0, 0, '2021-10-07 01:17:28'),
(453, 2, 312, 1, 0, 1, 0, '2021-09-20 00:04:18'),
(454, 2, 314, 1, 1, 0, 1, '2021-09-22 19:32:53'),
(455, 2, 355, 1, 0, 1, 0, '2021-09-20 00:04:18'),
(456, 3, 152, 1, 0, 0, 0, '2021-10-07 01:50:59'),
(463, 3, 353, 1, 0, 0, 0, '2021-10-07 01:50:59'),
(465, 2, 152, 1, 0, 0, 0, '2021-10-07 01:21:53'),
(466, 2, 153, 1, 0, 0, 0, '2021-10-07 01:22:48'),
(472, 2, 353, 1, 0, 1, 0, '2021-09-20 00:34:19'),
(474, 3, 168, 1, 0, 0, 0, '2021-10-07 01:56:13'),
(475, 2, 146, 1, 0, 0, 0, '2021-10-07 01:12:21'),
(476, 2, 148, 1, 0, 0, 0, '2021-10-07 01:12:21'),
(478, 2, 200, 1, 0, 0, 0, '2021-10-07 01:14:19'),
(481, 2, 225, 1, 0, 0, 0, '2021-10-07 01:14:19'),
(484, 2, 291, 1, 1, 0, 0, '2021-10-07 05:33:32'),
(485, 2, 292, 1, 1, 0, 0, '2021-10-07 05:33:32'),
(486, 2, 313, 1, 1, 0, 0, '2021-10-07 05:33:32'),
(495, 3, 270, 1, 1, 0, 1, '2021-09-20 01:25:18'),
(496, 2, 168, 1, 0, 0, 0, '2021-10-07 01:24:37'),
(498, 2, 202, 1, 0, 0, 0, '2021-10-07 01:24:42'),
(500, 2, 293, 1, 0, 0, 0, '2021-10-07 01:25:10'),
(501, 2, 302, 1, 0, 0, 0, '2021-10-07 01:25:10'),
(502, 2, 311, 1, 0, 0, 0, '2021-10-07 01:25:10'),
(503, 2, 317, 1, 1, 0, 1, '2021-09-21 02:02:20'),
(504, 3, 102, 1, 1, 1, 1, '2021-09-20 01:26:19'),
(506, 3, 118, 1, 0, 0, 0, '2021-09-20 01:29:24'),
(519, 3, 173, 1, 0, 0, 0, '2021-10-07 01:56:37'),
(520, 3, 347, 1, 0, 0, 0, '2021-10-07 01:56:37'),
(527, 3, 176, 1, 0, 0, 0, '2021-10-07 02:01:51'),
(530, 3, 289, 1, 0, 0, 0, '2021-10-07 02:01:51'),
(531, 3, 290, 1, 0, 0, 0, '2021-10-07 02:01:51'),
(533, 3, 330, 1, 0, 0, 0, '2021-09-20 01:46:52'),
(534, 3, 331, 1, 0, 0, 0, '2021-10-07 05:42:53'),
(535, 3, 332, 1, 0, 0, 0, '2021-09-20 01:46:52'),
(536, 3, 333, 1, 0, 0, 0, '2021-09-20 01:46:52'),
(537, 3, 334, 1, 0, 0, 0, '2021-09-20 01:46:52'),
(538, 3, 335, 1, 0, 0, 0, '2021-10-07 02:00:10'),
(539, 3, 336, 1, 0, 0, 0, '2021-09-20 01:46:52'),
(540, 3, 337, 1, 0, 0, 0, '2021-09-20 01:46:52'),
(541, 3, 338, 1, 0, 0, 0, '2021-09-20 01:46:52'),
(542, 3, 339, 1, 0, 0, 0, '2021-10-07 02:00:10'),
(543, 3, 340, 1, 0, 0, 0, '2021-09-20 01:46:52'),
(544, 3, 341, 1, 0, 0, 0, '2021-09-21 02:32:35'),
(545, 3, 342, 1, 0, 0, 0, '2021-09-20 01:46:52'),
(546, 3, 343, 1, 0, 0, 0, '2021-09-20 01:46:52'),
(547, 3, 344, 1, 0, 0, 0, '2021-09-20 01:46:52'),
(548, 3, 345, 1, 0, 0, 0, '2021-09-20 01:46:52'),
(550, 3, 166, 1, 0, 0, 0, '2021-09-21 01:50:56'),
(565, 3, 204, 1, 1, 1, 1, '2021-09-20 18:43:10'),
(566, 3, 205, 1, 0, 0, 0, '2021-09-20 02:08:03'),
(567, 3, 216, 1, 0, 0, 0, '2021-09-20 02:08:03'),
(568, 3, 217, 1, 0, 0, 0, '2021-09-20 02:08:03'),
(573, 3, 214, 1, 1, 1, 1, '2021-09-20 02:18:50'),
(574, 3, 215, 1, 1, 1, 1, '2021-09-20 02:18:50'),
(577, 3, 294, 1, 1, 1, 1, '2021-10-07 05:43:36'),
(578, 3, 295, 1, 0, 1, 0, '2021-09-20 23:39:37'),
(579, 3, 296, 1, 1, 1, 1, '2021-09-20 23:39:37'),
(580, 3, 297, 1, 0, 0, 0, '2021-10-07 05:43:36'),
(581, 3, 298, 1, 0, 0, 0, '2021-10-07 05:43:36'),
(584, 2, 165, 1, 0, 0, 0, '2021-10-07 05:35:28'),
(585, 2, 166, 1, 0, 0, 0, '2021-10-07 01:35:03'),
(594, 2, 204, 1, 1, 1, 1, '2021-09-20 18:35:02'),
(596, 2, 216, 1, 0, 0, 0, '2021-09-20 18:14:53'),
(597, 2, 217, 1, 0, 0, 0, '2021-09-20 18:14:53'),
(607, 2, 294, 1, 1, 1, 1, '2021-09-20 20:46:45'),
(608, 2, 295, 1, 0, 1, 0, '2021-09-20 19:50:38'),
(609, 2, 296, 1, 1, 1, 1, '2021-09-20 20:46:45'),
(610, 2, 297, 1, 0, 1, 0, '2021-09-20 19:50:38'),
(611, 2, 298, 1, 0, 1, 0, '2021-09-20 19:50:38'),
(612, 2, 102, 1, 1, 1, 1, '2021-10-07 01:46:19'),
(614, 2, 304, 1, 0, 0, 0, '2021-09-20 20:11:46'),
(619, 3, 302, 1, 0, 0, 0, '2021-10-07 01:56:13'),
(620, 3, 311, 1, 0, 0, 0, '2021-10-07 01:56:13'),
(624, 3, 269, 1, 1, 0, 1, '2021-09-20 20:50:56'),
(626, 2, 176, 1, 1, 1, 1, '2021-09-20 20:55:32'),
(627, 2, 203, 1, 1, 1, 1, '2021-09-20 20:55:32'),
(629, 2, 289, 1, 1, 1, 1, '2021-09-20 20:55:32'),
(630, 2, 290, 1, 1, 1, 1, '2021-09-20 20:55:32'),
(631, 2, 9, 1, 1, 1, 1, '2021-10-07 01:27:11'),
(632, 2, 10, 1, 1, 1, 1, '2021-10-07 01:27:11'),
(633, 2, 12, 1, 1, 1, 1, '2021-09-20 21:09:31'),
(634, 2, 13, 1, 1, 1, 1, '2021-09-22 19:19:22'),
(639, 2, 330, 1, 0, 0, 0, '2021-09-20 22:27:44'),
(640, 2, 331, 1, 1, 0, 0, '2021-09-20 22:53:32'),
(641, 2, 332, 1, 0, 0, 0, '2021-09-20 22:27:44'),
(642, 2, 333, 1, 1, 0, 0, '2021-09-20 22:53:32'),
(643, 2, 334, 1, 0, 0, 0, '2021-09-20 22:27:44'),
(644, 2, 335, 1, 1, 0, 0, '2021-09-21 01:52:27'),
(646, 2, 337, 1, 1, 0, 0, '2021-09-21 19:15:44'),
(647, 2, 338, 1, 0, 0, 0, '2021-09-20 22:27:44'),
(648, 2, 339, 1, 1, 0, 0, '2021-09-21 00:38:37'),
(649, 2, 340, 1, 0, 0, 0, '2021-09-20 22:27:44'),
(650, 2, 341, 1, 1, 0, 0, '2021-09-22 19:19:22'),
(651, 2, 342, 1, 0, 0, 0, '2021-09-20 22:27:44'),
(652, 2, 343, 1, 1, 0, 0, '2021-09-22 19:19:22'),
(653, 2, 344, 1, 0, 0, 0, '2021-09-20 22:27:44'),
(654, 2, 345, 1, 0, 0, 0, '2021-09-20 22:27:44'),
(655, 2, 48, 1, 0, 0, 0, '2021-09-20 23:01:51'),
(658, 2, 178, 1, 0, 0, 0, '2021-09-20 23:01:51'),
(659, 2, 179, 1, 0, 0, 0, '2021-09-20 23:01:51'),
(660, 2, 180, 1, 0, 0, 0, '2021-09-20 23:01:51'),
(661, 2, 181, 1, 0, 0, 0, '2021-09-20 23:01:51'),
(662, 2, 182, 1, 0, 0, 0, '2021-09-20 23:01:51'),
(667, 2, 188, 1, 0, 0, 0, '2021-09-20 23:01:51'),
(668, 2, 189, 1, 0, 0, 0, '2021-09-20 23:01:51'),
(669, 2, 206, 1, 0, 0, 0, '2021-09-20 23:01:51'),
(670, 2, 207, 1, 0, 0, 0, '2021-09-20 23:01:51'),
(671, 2, 208, 1, 0, 0, 0, '2021-09-20 23:01:51'),
(672, 2, 209, 1, 0, 0, 0, '2021-09-20 23:01:51'),
(673, 2, 210, 1, 0, 0, 0, '2021-09-20 23:01:51'),
(675, 2, 212, 1, 0, 0, 0, '2021-09-20 23:01:51'),
(676, 2, 213, 1, 0, 0, 0, '2021-09-20 23:01:51'),
(677, 2, 250, 1, 0, 0, 0, '2021-09-20 23:01:51'),
(678, 2, 251, 1, 0, 0, 0, '2021-09-20 23:01:51'),
(679, 2, 253, 1, 0, 0, 0, '2021-09-20 23:01:51'),
(680, 2, 254, 1, 0, 0, 0, '2021-09-20 23:01:51'),
(681, 2, 255, 1, 0, 0, 0, '2021-09-20 23:01:51'),
(687, 2, 271, 1, 0, 0, 0, '2021-09-20 23:01:51'),
(688, 2, 272, 1, 0, 0, 0, '2021-09-20 23:01:51'),
(689, 2, 349, 1, 0, 0, 0, '2021-09-20 23:01:51'),
(690, 2, 350, 1, 0, 0, 0, '2021-09-20 23:01:51'),
(691, 2, 351, 1, 0, 0, 0, '2021-09-20 23:01:51'),
(692, 2, 352, 1, 0, 0, 0, '2021-09-20 23:01:51'),
(693, 3, 86, 1, 0, 0, 0, '2021-10-07 02:07:51'),
(695, 2, 43, 1, 1, 1, 1, '2021-09-21 00:07:38'),
(696, 2, 44, 1, 0, 0, 0, '2021-09-20 23:59:29'),
(700, 3, 109, 1, 1, 0, 1, '2021-10-07 02:07:51'),
(703, 2, 27, 1, 1, 0, 1, '2021-09-21 00:22:26'),
(706, 2, 31, 1, 1, 0, 1, '2021-09-21 00:38:37'),
(707, 2, 32, 1, 1, 1, 1, '2021-09-21 00:38:37'),
(708, 2, 33, 1, 1, 1, 1, '2021-09-21 00:38:37'),
(709, 2, 34, 1, 1, 1, 1, '2021-09-21 00:38:37'),
(710, 2, 35, 1, 1, 1, 1, '2021-09-21 00:38:37'),
(711, 2, 104, 1, 1, 1, 1, '2021-09-21 00:38:37'),
(712, 2, 315, 1, 1, 0, 1, '2021-09-22 19:34:31'),
(726, 3, 43, 1, 1, 1, 1, '2021-09-21 01:03:20'),
(727, 3, 44, 1, 0, 0, 0, '2021-09-21 01:03:20'),
(728, 3, 27, 1, 1, 0, 1, '2021-09-21 01:12:55'),
(735, 3, 165, 1, 0, 0, 0, '2021-10-07 02:02:19'),
(750, 3, 267, 1, 1, 1, 1, '2021-09-21 01:47:43'),
(751, 3, 274, 1, 0, 0, 0, '2021-09-21 01:45:32'),
(752, 3, 279, 1, 1, 1, 1, '2021-09-21 01:47:43'),
(757, 2, 86, 1, 1, 1, 1, '2021-09-21 20:06:20'),
(764, 2, 283, 1, 1, 1, 1, '2021-09-22 01:07:28'),
(765, 2, 284, 1, 1, 1, 1, '2021-09-22 01:07:28'),
(766, 2, 285, 1, 1, 1, 1, '2021-09-22 01:07:28'),
(767, 2, 286, 1, 1, 1, 1, '2021-09-22 01:07:28'),
(768, 3, 48, 1, 0, 0, 0, '2021-09-21 02:12:03'),
(771, 3, 178, 1, 0, 0, 0, '2021-09-21 02:12:03'),
(775, 3, 182, 1, 0, 0, 0, '2021-09-21 02:12:03'),
(801, 3, 272, 1, 0, 0, 0, '2021-09-21 02:12:03'),
(806, 2, 88, 1, 0, 0, 0, '2021-10-07 05:36:29'),
(807, 2, 90, 1, 0, 0, 0, '2021-10-07 05:36:29'),
(809, 2, 109, 1, 1, 0, 1, '2021-09-27 06:57:53'),
(814, 2, 249, 1, 1, 1, 1, '2021-09-22 01:43:04'),
(816, 2, 310, 1, 0, 0, 0, '2021-09-21 18:00:40'),
(817, 2, 129, 0, 1, 0, 1, '2021-09-22 01:43:04'),
(819, 1, 362, 1, 0, 0, 0, '2021-09-21 18:50:19'),
(820, 1, 363, 1, 1, 1, 1, '2021-09-21 19:07:31'),
(821, 1, 364, 1, 0, 0, 0, '2021-09-21 18:59:42'),
(822, 1, 365, 1, 1, 1, 1, '2021-09-21 19:03:37'),
(823, 1, 366, 1, 0, 0, 0, '2021-09-21 18:59:42'),
(826, 2, 132, 1, 1, 1, 0, '2021-10-07 01:01:51'),
(849, 2, 319, 1, 0, 0, 0, '2021-10-07 05:31:49'),
(870, 3, 368, 1, 0, 0, 0, '2021-09-21 20:33:40'),
(924, 8, 152, 1, 0, 0, 0, '2021-10-07 04:04:37'),
(927, 4, 270, 1, 0, 0, 0, '2021-10-07 02:27:36'),
(948, 4, 334, 1, 0, 0, 0, '2021-09-21 23:56:07'),
(949, 4, 335, 1, 1, 0, 0, '2021-09-30 06:47:45'),
(962, 4, 176, 1, 1, 1, 1, '2021-10-07 05:52:38'),
(963, 4, 203, 1, 1, 1, 1, '2021-10-07 05:52:38'),
(965, 4, 289, 1, 1, 1, 1, '2021-09-30 07:32:30'),
(966, 4, 290, 1, 1, 1, 1, '2021-09-30 07:32:30'),
(983, 4, 216, 1, 0, 0, 0, '2021-09-22 00:25:36'),
(984, 4, 217, 1, 0, 0, 0, '2021-09-22 00:34:54'),
(990, 4, 86, 1, 0, 0, 0, '2021-10-07 02:37:32'),
(995, 4, 109, 1, 1, 0, 1, '2021-10-01 00:27:47'),
(1001, 2, 118, 1, 0, 0, 0, '2021-09-22 00:55:25'),
(1016, 4, 43, 1, 1, 1, 1, '2021-09-22 01:04:08'),
(1017, 4, 44, 1, 0, 0, 0, '2021-09-22 01:04:08'),
(1018, 4, 27, 1, 1, 0, 1, '2021-09-22 01:12:34'),
(1060, 4, 179, 1, 0, 0, 0, '2021-09-22 01:51:01'),
(1099, 2, 336, 1, 0, 0, 0, '2021-09-22 19:19:22'),
(1119, 1, 367, 1, 1, 1, 1, '2021-10-07 05:04:40'),
(1134, 50, 102, 1, 1, 1, 1, '2021-10-27 10:48:35'),
(1136, 50, 132, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(1137, 50, 134, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(1138, 50, 135, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(1141, 50, 218, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(1142, 50, 219, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(1145, 50, 299, 1, 1, 1, 1, '2021-10-27 10:49:53'),
(1146, 50, 303, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(1147, 50, 304, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(1148, 50, 305, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(1150, 50, 307, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(1151, 50, 319, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(1165, 5, 308, 1, 0, 0, 0, '2021-09-22 20:57:37'),
(1175, 5, 329, 1, 0, 0, 0, '2021-09-22 22:14:39'),
(1188, 1, 53, 1, 1, 0, 0, '2021-09-22 23:24:10'),
(1189, 5, 149, 1, 1, 1, 1, '2021-09-22 22:40:24'),
(1190, 5, 175, 1, 1, 1, 1, '2021-09-22 22:59:48'),
(1191, 5, 243, 1, 0, 1, 0, '2021-09-22 22:59:48'),
(1193, 5, 260, 1, 1, 1, 1, '2021-09-22 22:59:48'),
(1194, 5, 263, 1, 1, 1, 1, '2021-09-22 22:59:48'),
(1195, 5, 312, 1, 0, 1, 0, '2021-09-22 22:59:48'),
(1196, 5, 314, 1, 1, 0, 1, '2021-09-22 22:59:48'),
(1197, 5, 355, 1, 0, 1, 0, '2021-09-22 22:59:48'),
(1204, 50, 138, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(1205, 50, 139, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(1206, 50, 140, 1, 1, 1, 1, '2021-10-27 10:49:53'),
(1207, 50, 142, 1, 1, 1, 1, '2021-10-27 10:49:53'),
(1210, 50, 196, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(1212, 50, 198, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(1213, 50, 220, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(1215, 50, 300, 1, 1, 1, 1, '2021-10-27 10:49:53'),
(1216, 50, 301, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(1217, 50, 308, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(1218, 50, 309, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(1220, 50, 322, 1, 1, 1, 1, '2021-10-27 10:49:53'),
(1224, 50, 326, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(1225, 50, 327, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(1226, 50, 329, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(1235, 1, 191, 1, 0, 0, 0, '2021-09-22 23:49:17'),
(1246, 5, 317, 1, 1, 0, 1, '2021-09-23 00:16:36'),
(1248, 5, 270, 1, 0, 0, 0, '2021-10-07 03:23:02'),
(1250, 5, 102, 1, 1, 1, 1, '2021-09-23 00:32:09'),
(1251, 5, 346, 1, 0, 0, 0, '2021-09-23 00:32:09'),
(1269, 5, 337, 1, 1, 0, 0, '2021-09-23 01:31:48'),
(1278, 5, 236, 1, 0, 0, 0, '2021-10-07 03:26:02'),
(1306, 5, 216, 1, 0, 0, 0, '2021-09-23 01:40:28'),
(1307, 5, 217, 1, 0, 0, 0, '2021-09-23 01:40:28'),
(1317, 5, 86, 1, 0, 0, 0, '2021-10-07 03:29:26'),
(1322, 5, 109, 1, 1, 0, 1, '2021-09-23 19:36:32'),
(1329, 5, 43, 1, 1, 1, 1, '2021-09-30 00:45:54'),
(1330, 5, 44, 1, 0, 0, 0, '2021-09-23 02:12:30'),
(1331, 5, 27, 1, 1, 0, 1, '2021-09-23 02:15:51'),
(1355, 50, 270, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(1358, 50, 236, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(1370, 5, 158, 1, 0, 0, 0, '2021-09-23 19:44:20'),
(1416, 5, 369, 1, 0, 0, 0, '2021-09-23 20:16:25'),
(1426, 5, 180, 1, 0, 0, 0, '2021-09-23 20:23:15'),
(1460, 6, 270, 1, 0, 0, 0, '2021-10-07 03:38:49'),
(1503, 6, 304, 1, 0, 0, 0, '2021-09-27 00:19:54'),
(1509, 6, 319, 1, 0, 0, 0, '2021-10-07 06:03:09'),
(1518, 50, 216, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(1519, 50, 217, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(1579, 2, 155, 1, 0, 0, 0, '2021-09-27 05:41:19'),
(1580, 2, 156, 1, 0, 0, 0, '2021-09-27 05:41:19'),
(1581, 2, 157, 1, 0, 0, 0, '2021-09-27 05:41:19'),
(1582, 2, 158, 1, 0, 0, 0, '2021-09-27 05:41:19'),
(1583, 2, 159, 1, 0, 0, 0, '2021-09-27 05:41:19'),
(1584, 2, 161, 1, 0, 0, 0, '2021-09-27 05:41:19'),
(1585, 2, 162, 1, 0, 0, 0, '2021-09-27 05:41:19'),
(1586, 2, 190, 1, 0, 0, 0, '2021-09-27 05:41:19'),
(1587, 2, 191, 1, 0, 0, 0, '2021-09-27 05:41:19'),
(1588, 2, 238, 1, 0, 0, 0, '2021-09-27 05:41:19'),
(1596, 50, 48, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(1599, 50, 178, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(1603, 50, 182, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(1631, 50, 350, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(1663, 50, 27, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(1664, 50, 43, 1, 1, 1, 1, '2021-10-27 10:49:53'),
(1665, 50, 44, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(1666, 50, 86, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(1671, 50, 109, 1, 1, 0, 1, '2021-10-27 10:49:53'),
(1679, 50, 204, 1, 1, 1, 1, '2021-10-27 10:49:53'),
(1680, 50, 205, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(1697, 6, 152, 1, 1, 1, 1, '2021-09-28 05:21:22'),
(1698, 6, 153, 1, 1, 1, 1, '2021-09-28 05:21:22'),
(1699, 6, 171, 1, 1, 1, 1, '2021-09-28 05:21:22'),
(1700, 6, 244, 1, 0, 1, 0, '2021-09-28 05:21:22'),
(1701, 6, 261, 1, 1, 1, 1, '2021-09-28 05:21:22'),
(1702, 6, 262, 1, 1, 1, 1, '2021-09-28 05:21:22'),
(1703, 6, 315, 1, 1, 0, 1, '2021-09-28 05:21:22'),
(1704, 6, 353, 1, 0, 1, 0, '2021-09-28 05:21:22'),
(1705, 6, 354, 1, 0, 1, 0, '2021-09-28 05:21:22'),
(1713, 6, 236, 1, 0, 0, 0, '2021-10-07 03:46:01'),
(1716, 6, 176, 1, 1, 1, 1, '2021-10-07 06:04:58'),
(1719, 6, 289, 1, 1, 1, 1, '2021-09-28 06:47:58'),
(1720, 6, 290, 1, 1, 1, 1, '2021-09-28 06:47:58'),
(1739, 6, 43, 1, 1, 1, 1, '2021-09-28 07:53:01'),
(1740, 6, 44, 1, 0, 0, 0, '2021-09-28 07:51:03'),
(1741, 6, 27, 1, 1, 0, 1, '2021-09-28 07:57:40'),
(1742, 6, 118, 1, 0, 0, 0, '2021-09-28 07:59:22'),
(1747, 6, 159, 1, 0, 0, 0, '2021-09-28 07:59:22'),
(1782, 2, 205, 1, 0, 0, 0, '2021-09-29 03:01:52'),
(1823, 6, 338, 1, 0, 0, 0, '2021-09-29 05:47:03'),
(1824, 6, 339, 1, 1, 0, 0, '2021-09-29 06:07:31'),
(1831, 2, 318, 1, 1, 0, 1, '2021-09-29 06:26:26'),
(1838, 6, 181, 1, 0, 0, 0, '2021-09-29 06:27:14'),
(1872, 6, 102, 1, 1, 1, 1, '2021-09-29 06:31:52'),
(1873, 6, 86, 1, 0, 0, 0, '2021-10-07 03:48:51'),
(1878, 6, 109, 1, 1, 0, 1, '2021-09-29 07:05:03'),
(1900, 6, 329, 1, 0, 0, 0, '2021-09-29 07:59:38'),
(1906, 5, 370, 1, 0, 0, 0, '2021-09-30 02:11:43'),
(1908, 4, 146, 1, 1, 1, 1, '2021-10-07 02:24:11'),
(1909, 4, 148, 1, 1, 1, 1, '2021-10-07 02:24:11'),
(1910, 4, 170, 1, 1, 1, 1, '2021-10-07 02:24:11'),
(1911, 4, 200, 1, 1, 0, 1, '2021-10-07 02:24:11'),
(1912, 4, 201, 1, 0, 1, 0, '2021-09-30 05:42:41'),
(1913, 4, 224, 1, 0, 0, 0, '2021-09-30 05:36:57'),
(1914, 4, 225, 1, 1, 0, 1, '2021-10-07 02:24:11'),
(1915, 4, 226, 1, 1, 1, 1, '2021-10-07 02:24:11'),
(1916, 4, 227, 1, 1, 1, 1, '2021-10-07 02:24:11'),
(1917, 4, 291, 1, 1, 1, 1, '2021-10-07 02:24:11'),
(1918, 4, 292, 1, 1, 1, 1, '2021-10-07 02:24:11'),
(1919, 4, 313, 1, 1, 0, 1, '2021-10-07 02:24:11'),
(1931, 4, 236, 1, 0, 0, 0, '2021-10-07 02:30:35'),
(1934, 4, 118, 1, 0, 0, 0, '2021-10-01 00:51:45'),
(1937, 4, 157, 1, 0, 0, 0, '2021-10-01 00:51:45'),
(1944, 4, 238, 1, 0, 0, 0, '2021-10-01 00:51:45'),
(1957, 4, 256, 1, 0, 0, 0, '2021-10-01 00:54:01'),
(1976, 4, 102, 1, 1, 1, 1, '2021-10-01 01:33:49'),
(1977, 4, 274, 1, 0, 0, 0, '2021-10-01 01:36:40'),
(1980, 50, 137, 1, 1, 1, 1, '2021-10-27 10:49:53'),
(1981, 2, 173, 1, 1, 1, 1, '2021-10-07 05:34:24'),
(1982, 2, 347, 1, 0, 1, 1, '2021-10-07 05:34:24'),
(1995, 1, 196, 1, 1, 1, 1, '2021-10-07 04:55:23'),
(1996, 1, 323, 1, 1, 1, 1, '2021-10-07 04:55:23'),
(1997, 1, 324, 1, 1, 1, 1, '2021-10-07 04:55:23'),
(1998, 1, 325, 1, 1, 1, 1, '2021-10-07 04:55:23'),
(1999, 1, 236, 1, 1, 1, 1, '2021-10-07 00:36:12'),
(2001, 2, 270, 1, 0, 0, 0, '2021-10-07 01:25:46'),
(2002, 2, 236, 1, 1, 1, 0, '2021-10-07 01:28:54'),
(2003, 2, 266, 1, 0, 0, 0, '2021-10-07 01:43:54'),
(2019, 8, 132, 1, 1, 1, 1, '2021-10-07 04:00:10'),
(2020, 8, 135, 1, 1, 1, 1, '2021-10-07 04:00:10'),
(2021, 8, 218, 1, 0, 0, 0, '2021-10-07 04:00:10'),
(2022, 8, 219, 1, 0, 0, 0, '2021-10-07 04:00:10'),
(2023, 8, 221, 1, 1, 1, 1, '2021-10-07 06:09:52'),
(2024, 8, 222, 1, 1, 0, 1, '2021-10-07 06:09:52'),
(2025, 8, 138, 1, 1, 1, 1, '2021-10-07 04:00:35'),
(2026, 8, 139, 1, 1, 1, 1, '2021-10-07 04:00:35'),
(2027, 8, 143, 1, 1, 1, 1, '2021-10-07 06:10:36'),
(2028, 8, 144, 1, 1, 0, 1, '2021-10-07 06:10:36'),
(2029, 8, 326, 1, 0, 0, 0, '2021-10-07 04:01:17'),
(2031, 8, 196, 1, 1, 1, 1, '2021-10-07 06:10:36'),
(2032, 8, 198, 1, 0, 0, 0, '2021-10-07 04:03:01'),
(2034, 4, 202, 1, 0, 0, 0, '2021-10-07 04:03:15'),
(2035, 8, 146, 1, 0, 0, 0, '2021-10-07 04:03:54'),
(2036, 8, 148, 1, 0, 0, 0, '2021-10-07 04:03:54'),
(2037, 8, 200, 1, 0, 0, 0, '2021-10-07 04:03:54'),
(2038, 8, 225, 1, 0, 0, 0, '2021-10-07 04:03:54'),
(2039, 8, 149, 1, 0, 0, 0, '2021-10-07 04:04:27'),
(2042, 8, 168, 1, 0, 0, 0, '2021-10-07 04:04:59'),
(2043, 8, 270, 1, 0, 0, 0, '2021-10-07 04:05:25'),
(2044, 8, 173, 1, 0, 0, 0, '2021-10-07 04:06:20'),
(2045, 8, 347, 1, 0, 0, 0, '2021-10-07 04:06:20'),
(2046, 8, 330, 1, 0, 0, 0, '2021-10-07 04:08:02'),
(2047, 8, 332, 1, 0, 0, 0, '2021-10-07 04:08:02'),
(2048, 8, 334, 1, 0, 0, 0, '2021-10-07 04:08:02'),
(2049, 8, 336, 1, 0, 0, 0, '2021-10-07 04:08:02'),
(2050, 8, 338, 1, 0, 0, 0, '2021-10-07 04:08:02'),
(2051, 8, 340, 1, 0, 0, 0, '2021-10-07 04:08:02'),
(2052, 8, 342, 1, 0, 0, 0, '2021-10-07 04:08:02'),
(2053, 8, 236, 1, 1, 1, 0, '2021-10-07 04:08:58'),
(2055, 8, 165, 1, 1, 1, 1, '2021-10-07 06:12:31'),
(2056, 8, 166, 1, 1, 1, 1, '2021-10-07 06:12:31'),
(2057, 8, 80, 1, 1, 1, 1, '2021-10-07 04:11:10'),
(2058, 8, 81, 1, 1, 1, 1, '2021-10-07 04:11:10'),
(2059, 8, 82, 1, 1, 1, 1, '2021-10-07 04:11:10'),
(2060, 8, 83, 1, 1, 1, 1, '2021-10-07 04:11:10'),
(2061, 8, 84, 1, 1, 1, 1, '2021-10-07 04:11:10'),
(2062, 8, 85, 1, 1, 1, 1, '2021-10-07 04:11:10'),
(2063, 8, 204, 1, 1, 1, 1, '2021-10-07 04:11:10'),
(2064, 8, 205, 1, 0, 0, 0, '2021-10-07 04:11:10'),
(2065, 8, 214, 1, 0, 0, 0, '2021-10-07 04:11:28'),
(2066, 8, 215, 1, 0, 0, 0, '2021-10-07 04:11:28'),
(2067, 8, 86, 1, 0, 0, 0, '2021-10-07 04:11:47'),
(2068, 8, 109, 1, 1, 0, 1, '2021-10-07 04:11:47'),
(2069, 8, 31, 1, 0, 0, 0, '2021-10-07 04:12:14'),
(2070, 8, 32, 1, 0, 0, 0, '2021-10-07 04:12:14'),
(2071, 8, 48, 1, 0, 0, 0, '2021-10-07 04:13:52'),
(2072, 8, 89, 1, 0, 0, 0, '2021-10-07 04:13:52'),
(2073, 8, 178, 1, 0, 0, 0, '2021-10-07 04:13:52'),
(2074, 8, 180, 1, 0, 0, 0, '2021-10-07 04:13:52'),
(2075, 8, 181, 1, 0, 0, 0, '2021-10-07 04:13:52'),
(2076, 8, 182, 1, 0, 0, 0, '2021-10-07 04:13:52'),
(2077, 8, 207, 1, 0, 0, 0, '2021-10-07 04:13:52'),
(2078, 8, 208, 1, 0, 0, 0, '2021-10-07 04:13:52'),
(2079, 8, 209, 1, 0, 0, 0, '2021-10-07 04:13:52'),
(2080, 8, 253, 1, 0, 0, 0, '2021-10-07 04:13:52'),
(2081, 8, 254, 1, 0, 0, 0, '2021-10-07 04:13:52'),
(2082, 8, 255, 1, 0, 0, 0, '2021-10-07 04:13:52'),
(2083, 8, 118, 1, 0, 0, 0, '2021-10-07 04:14:18'),
(2084, 8, 238, 1, 0, 0, 0, '2021-10-07 04:14:18'),
(2085, 8, 102, 1, 1, 1, 1, '2021-10-07 04:14:38'),
(2086, 50, 321, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(2093, 1, 132, 1, 1, 1, 1, '2021-10-07 04:54:53'),
(2094, 1, 198, 1, 0, 0, 0, '2021-10-07 04:55:23'),
(2095, 1, 327, 1, 0, 0, 0, '2021-10-07 04:55:23'),
(2096, 1, 329, 1, 0, 0, 0, '2021-10-07 04:55:23'),
(2108, 1, 294, 1, 1, 1, 1, '2021-10-07 04:56:29'),
(2109, 1, 296, 1, 1, 1, 1, '2021-10-07 04:56:29'),
(2110, 1, 297, 1, 0, 0, 0, '2021-10-07 04:56:29'),
(2111, 1, 298, 1, 0, 0, 0, '2021-10-07 04:56:29'),
(2112, 1, 129, 0, 1, 0, 1, '2021-10-07 04:56:43'),
(2113, 1, 27, 1, 1, 0, 1, '2021-10-07 04:56:54'),
(2114, 1, 155, 1, 0, 0, 0, '2021-10-07 04:57:41'),
(2115, 1, 156, 1, 0, 0, 0, '2021-10-07 04:57:41'),
(2116, 1, 157, 1, 0, 0, 0, '2021-10-07 04:57:41'),
(2117, 1, 158, 1, 0, 0, 0, '2021-10-07 04:57:41'),
(2118, 1, 159, 1, 0, 0, 0, '2021-10-07 04:57:41'),
(2119, 1, 161, 1, 0, 0, 0, '2021-10-07 04:57:41'),
(2120, 1, 162, 1, 0, 0, 0, '2021-10-07 04:57:41'),
(2121, 1, 190, 1, 0, 0, 0, '2021-10-07 04:57:41'),
(2122, 1, 238, 1, 0, 0, 0, '2021-10-07 04:57:41'),
(2127, 1, 320, 1, 0, 0, 0, '2021-10-07 05:01:34'),
(2128, 1, 321, 1, 0, 0, 0, '2021-10-07 05:01:34'),
(2135, 1, 371, 1, 0, 0, 0, '2021-10-07 05:05:30'),
(2150, 1, 280, 1, 1, 1, 1, '2021-10-07 05:29:08'),
(2151, 1, 369, 1, 0, 0, 0, '2021-10-07 05:30:23'),
(2152, 1, 370, 1, 0, 0, 0, '2021-10-07 05:30:23'),
(2153, 1, 281, 1, 0, 0, 0, '2021-10-07 05:30:36'),
(2154, 1, 282, 1, 0, 0, 0, '2021-10-07 05:30:36'),
(2155, 2, 321, 1, 0, 0, 0, '2021-10-07 05:31:49'),
(2156, 2, 197, 1, 0, 0, 0, '2021-10-07 05:33:02'),
(2157, 2, 248, 1, 0, 0, 0, '2021-10-07 05:33:02'),
(2158, 2, 264, 1, 1, 0, 1, '2021-10-07 05:34:52'),
(2159, 2, 247, 1, 0, 0, 0, '2021-10-07 05:35:28'),
(2160, 2, 281, 1, 0, 0, 0, '2021-10-07 05:40:09'),
(2161, 2, 282, 1, 0, 0, 0, '2021-10-07 05:40:09'),
(2162, 2, 371, 1, 0, 0, 0, '2021-10-07 05:40:26'),
(2163, 3, 257, 1, 0, 0, 0, '2021-10-07 05:41:20'),
(2164, 3, 355, 1, 0, 0, 0, '2021-10-07 05:41:20'),
(2165, 3, 153, 1, 0, 0, 0, '2021-10-07 05:41:40'),
(2166, 3, 244, 1, 0, 0, 0, '2021-10-07 05:41:40'),
(2167, 3, 354, 1, 0, 0, 0, '2021-10-07 05:41:40'),
(2168, 3, 202, 1, 0, 0, 0, '2021-10-07 05:42:06'),
(2169, 3, 246, 1, 0, 0, 0, '2021-10-07 05:42:06'),
(2170, 3, 237, 1, 0, 0, 0, '2021-10-07 05:43:04'),
(2171, 3, 240, 1, 0, 1, 0, '2021-10-07 05:43:28'),
(2172, 3, 242, 1, 0, 1, 0, '2021-10-07 05:43:28'),
(2173, 3, 129, 0, 1, 0, 1, '2021-10-07 05:43:59'),
(2174, 3, 183, 1, 0, 0, 0, '2021-10-07 05:46:03'),
(2175, 3, 188, 1, 0, 0, 0, '2021-10-07 05:46:03'),
(2176, 3, 206, 1, 0, 0, 0, '2021-10-07 05:46:03'),
(2177, 3, 207, 1, 0, 0, 0, '2021-10-07 05:46:03'),
(2178, 3, 208, 1, 0, 0, 0, '2021-10-07 05:46:03'),
(2179, 3, 209, 1, 0, 0, 0, '2021-10-07 05:46:03'),
(2180, 3, 211, 1, 0, 0, 0, '2021-10-07 05:46:03'),
(2181, 3, 258, 1, 0, 0, 0, '2021-10-07 05:46:03'),
(2182, 3, 271, 1, 0, 0, 0, '2021-10-07 05:46:03'),
(2183, 3, 350, 1, 0, 0, 0, '2021-10-07 05:46:03'),
(2184, 3, 369, 1, 0, 0, 0, '2021-10-07 05:46:03'),
(2185, 3, 238, 1, 0, 0, 0, '2021-10-07 05:46:28'),
(2186, 3, 362, 1, 0, 0, 0, '2021-10-07 05:46:52'),
(2187, 3, 363, 1, 1, 1, 1, '2021-10-07 05:47:07'),
(2188, 3, 366, 1, 0, 0, 0, '2021-10-07 05:46:52'),
(2189, 3, 367, 1, 1, 1, 1, '2021-10-07 05:47:07'),
(2190, 3, 371, 1, 0, 0, 0, '2021-10-07 05:47:23'),
(2194, 4, 132, 1, 0, 0, 0, '2021-10-07 05:50:59'),
(2195, 4, 138, 1, 0, 0, 0, '2021-10-07 05:51:05'),
(2196, 4, 264, 1, 1, 0, 1, '2021-10-07 05:52:38'),
(2198, 4, 371, 1, 0, 0, 0, '2021-10-07 05:56:00'),
(2201, 5, 132, 1, 0, 0, 0, '2021-10-07 05:56:53'),
(2202, 5, 304, 1, 0, 0, 0, '2021-10-07 05:56:53'),
(2204, 5, 138, 1, 0, 0, 0, '2021-10-07 05:57:32'),
(2205, 5, 139, 1, 0, 0, 0, '2021-10-07 05:57:32'),
(2206, 5, 307, 1, 0, 0, 0, '2021-10-07 05:57:47'),
(2207, 5, 257, 1, 1, 1, 1, '2021-10-07 05:58:05'),
(2209, 5, 168, 1, 1, 1, 1, '2021-10-07 05:58:48'),
(2210, 5, 169, 1, 1, 1, 1, '2021-10-07 05:58:48'),
(2211, 5, 202, 1, 1, 0, 1, '2021-10-07 05:58:48'),
(2212, 5, 246, 1, 0, 0, 0, '2021-10-07 05:58:48'),
(2213, 5, 293, 1, 1, 1, 1, '2021-10-07 05:58:48'),
(2214, 5, 302, 1, 1, 0, 1, '2021-10-07 05:58:48'),
(2215, 5, 311, 1, 1, 1, 1, '2021-10-07 05:58:48'),
(2216, 5, 336, 1, 0, 0, 0, '2021-10-07 05:59:04'),
(2217, 5, 274, 1, 0, 0, 0, '2021-10-07 06:00:38'),
(2219, 5, 183, 1, 0, 0, 0, '2021-10-07 06:01:42'),
(2220, 5, 211, 1, 0, 0, 0, '2021-10-07 06:01:42'),
(2221, 5, 371, 1, 0, 0, 0, '2021-10-07 06:02:10'),
(2222, 6, 132, 1, 0, 0, 0, '2021-10-07 06:03:09'),
(2223, 6, 135, 1, 0, 0, 0, '2021-10-07 06:03:09'),
(2224, 6, 138, 1, 0, 0, 0, '2021-10-07 06:03:45'),
(2225, 6, 139, 1, 0, 0, 0, '2021-10-07 06:03:45'),
(2226, 6, 308, 1, 0, 0, 0, '2021-10-07 06:03:45'),
(2227, 6, 309, 1, 0, 0, 0, '2021-10-07 06:03:45'),
(2228, 6, 203, 1, 1, 1, 1, '2021-10-07 06:04:58'),
(2229, 6, 264, 1, 1, 0, 1, '2021-10-07 06:04:58'),
(2231, 6, 274, 1, 0, 0, 0, '2021-10-07 06:06:19'),
(2232, 6, 371, 1, 0, 0, 0, '2021-10-07 06:07:27'),
(2233, 8, 304, 1, 0, 0, 0, '2021-10-07 06:09:52'),
(2234, 8, 305, 1, 0, 1, 0, '2021-10-07 06:09:52'),
(2235, 8, 306, 1, 0, 0, 0, '2021-10-07 06:09:52'),
(2236, 8, 307, 1, 0, 0, 0, '2021-10-07 06:09:52'),
(2237, 8, 319, 1, 1, 1, 1, '2021-10-07 06:09:52'),
(2238, 8, 320, 1, 0, 0, 0, '2021-10-07 06:09:52'),
(2239, 8, 301, 1, 0, 0, 0, '2021-10-07 06:10:36'),
(2240, 8, 309, 1, 0, 1, 0, '2021-10-07 06:10:36'),
(2241, 8, 310, 1, 0, 0, 0, '2021-10-07 06:10:36'),
(2242, 8, 329, 1, 0, 0, 0, '2021-10-07 06:10:36'),
(2243, 8, 257, 1, 0, 0, 0, '2021-10-07 06:10:57'),
(2244, 8, 153, 1, 0, 0, 0, '2021-10-07 06:11:07'),
(2245, 8, 169, 1, 0, 0, 0, '2021-10-07 06:11:37'),
(2246, 8, 202, 1, 0, 0, 0, '2021-10-07 06:11:37'),
(2247, 8, 302, 1, 0, 0, 0, '2021-10-07 06:11:37'),
(2248, 8, 311, 1, 0, 0, 0, '2021-10-07 06:11:37'),
(2249, 2, 348, 1, 0, 1, 0, '2021-10-07 06:17:44'),
(2250, 8, 247, 1, 1, 1, 1, '2021-10-07 06:12:31'),
(2251, 8, 318, 1, 1, 0, 1, '2021-10-07 06:12:31'),
(2252, 8, 294, 1, 1, 1, 1, '2021-10-07 06:13:02'),
(2253, 8, 295, 1, 0, 1, 0, '2021-10-07 06:13:02'),
(2254, 8, 296, 1, 1, 1, 1, '2021-10-07 06:13:02'),
(2255, 8, 297, 1, 0, 0, 0, '2021-10-07 06:13:02'),
(2256, 8, 298, 1, 0, 0, 0, '2021-10-07 06:13:02'),
(2257, 2, 56, 1, 0, 0, 0, '2021-10-07 06:13:19'),
(2258, 8, 43, 1, 1, 1, 1, '2021-10-07 06:13:22'),
(2259, 8, 44, 1, 0, 0, 0, '2021-10-07 06:13:22'),
(2260, 8, 27, 1, 1, 0, 1, '2021-10-07 06:13:28'),
(2261, 8, 274, 1, 0, 0, 0, '2021-10-07 06:13:45'),
(2262, 2, 54, 1, 0, 0, 0, '2021-10-07 06:13:47'),
(2263, 8, 183, 1, 0, 0, 0, '2021-10-07 06:15:00'),
(2264, 8, 256, 1, 0, 0, 0, '2021-10-07 06:15:00'),
(2265, 8, 258, 1, 0, 0, 0, '2021-10-07 06:15:00'),
(2266, 8, 259, 1, 0, 0, 0, '2021-10-07 06:15:00'),
(2267, 8, 350, 1, 0, 0, 0, '2021-10-07 06:15:00'),
(2268, 8, 162, 1, 0, 0, 0, '2021-10-07 06:15:18'),
(2269, 8, 371, 1, 0, 0, 0, '2021-10-07 06:15:32'),
(2271, 50, 274, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(2272, 50, 118, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(2273, 50, 238, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(2274, 50, 371, 1, 0, 0, 0, '2021-10-27 10:49:53'),
(2275, 1, 218, 1, 0, 0, 0, '2021-10-07 06:20:53'),
(2276, 1, 330, 1, 0, 0, 0, '2021-10-22 00:27:48'),
(2277, 1, 331, 1, 1, 0, 0, '2021-10-22 00:27:48'),
(2278, 1, 332, 1, 0, 0, 0, '2021-10-22 00:27:48'),
(2279, 1, 333, 1, 1, 0, 0, '2021-10-22 00:27:48'),
(2280, 1, 334, 1, 0, 0, 0, '2021-10-22 00:27:48'),
(2281, 1, 335, 1, 1, 0, 0, '2021-10-22 00:27:48'),
(2282, 1, 336, 1, 0, 0, 0, '2021-10-22 00:27:48'),
(2283, 1, 337, 1, 1, 0, 0, '2021-10-22 00:27:48'),
(2284, 1, 338, 1, 0, 0, 0, '2021-10-22 00:27:48'),
(2285, 1, 339, 1, 1, 0, 0, '2021-10-22 00:27:48'),
(2286, 1, 340, 1, 0, 0, 0, '2021-10-22 00:27:48'),
(2287, 1, 341, 1, 1, 0, 0, '2021-10-22 00:27:48'),
(2288, 1, 342, 1, 0, 0, 0, '2021-10-22 00:27:48'),
(2289, 1, 343, 1, 1, 0, 0, '2021-10-22 00:27:48'),
(2290, 1, 344, 1, 0, 0, 0, '2021-10-22 00:27:48'),
(2291, 1, 345, 1, 0, 0, 0, '2021-10-22 00:27:48'),
(2292, 1, 372, 1, 0, 0, 0, '2021-10-29 07:41:42'),
(2293, 1, 373, 1, 0, 0, 0, '2021-10-29 07:42:20'),
(2294, 1, 374, 1, 1, 1, 1, '2021-10-29 07:45:25'),
(2295, 1, 375, 1, 1, 1, 1, '2021-10-29 07:45:25');

INSERT INTO `permission_patient` (`id`, `permission_group_short_code`, `name`, `short_code`, `is_active`, `system`, `sort_order`, `created_at`) VALUES
(1, 'appointment', 'My Appointments', 'my_appointments', 1, 0, '1.00', '2021-09-27 13:17:05'),
(2, 'opd', 'OPD', 'opd', 1, 0, '2.00', '2021-09-27 13:17:21'),
(3, 'ipd', 'IPD', 'ipd', 1, 0, '3.00', '2021-09-25 09:33:07'),
(4, 'pharmacy', 'Pharmacy', 'pharmacy', 1, 0, '4.00', '2021-09-25 06:03:29'),
(5, 'pathology', 'Pathology', 'pathology', 1, 0, '5.00', '2021-09-27 13:15:45'),
(6, 'radiology', 'Radiology', 'radiology', 1, 0, '6.00', '2021-09-27 13:15:47'),
(7, 'ambulance', 'Ambulance', 'ambulance', 1, 0, '7.00', '2021-09-27 13:15:50'),
(8, 'blood_bank', 'Blood Bank', 'blood_bank', 1, 0, '8.00', '2021-09-24 07:40:59'),
(9, 'live_consultation', 'Live Consultation', 'live_consultation', 1, 0, '9.00', '2021-09-27 13:16:49'),
(10, 'calendar_to_do_list', 'Calendar To Do List', 'calendar_to_do_list', 1, 0, '11.00', '2021-10-04 09:07:25'),
(11, 'chat', 'Chat', 'chat', 1, 0, '11.00', '2021-10-04 07:34:59');

INSERT INTO `languages` (`id`, `language`, `short_code`, `country_code`, `is_deleted`, `is_rtl`, `is_active`, `created_at`, `updated_at`) VALUES
(null, 'Lao', 'lo', 'la', 'no', 'no', 'no', '2021-10-25 07:56:47', NULL),
(null, 'Croatia ', 'hr', 'hr', 'no', 'no', 'no', '2021-10-25 07:56:41', NULL);

INSERT INTO `patient_id_card` (`id`, `title`, `hospital_name`, `hospital_address`, `background`, `logo`, `sign_image`, `header_color`, `enable_patient_name`, `enable_guardian_name`, `enable_patient_unique_id`, `enable_address`, `enable_phone`, `enable_dob`, `enable_blood_group`, `status`, `created_at`) VALUES
(null, 'Sample Patient Id Card', 'Royal Hospital', 'Nr Loyala Ashram, A 69, Shahpura Rd, Manisha Market, Sector  Bhopal', 'background.jpg', 'logo.jpg', 'signature.png', '#0796f5', 1, 1, 1, 1, 1, 1, 1, 1, '2021-10-19 12:36:02');

INSERT INTO `staff_id_card` (`id`, `title`, `hospital_name`, `hospital_address`, `background`, `logo`, `sign_image`, `header_color`, `enable_staff_role`, `enable_staff_id`, `enable_staff_department`, `enable_designation`, `enable_name`, `enable_fathers_name`, `enable_mothers_name`, `enable_date_of_joining`, `enable_permanent_address`, `enable_staff_dob`, `enable_staff_phone`, `status`, `created_at`) VALUES
(null, 'Sample Staff Id Card', 'National Hospital', 'Habibganj Rd, Opp Cricket Club, E-3, Arera Colony, Bhopal', 'background.jpg', 'logo.jpg', 'signature.png', '#0e5c9f', 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 1, 1, '2021-10-19 12:28:50');

INSERT INTO `certificates` (`id`, `certificate_name`, `certificate_text`, `left_header`, `center_header`, `right_header`, `left_footer`, `right_footer`, `center_footer`, `background_image`, `created_for`, `status`, `header_height`, `content_height`, `footer_height`, `content_width`, `enable_patient_image`, `enable_image_height`, `updated_at`, `created_at`) VALUES
(12, 'Sample Patient File Cover', '<table class=\"table table-bordered\" width=\"100%\">\r\n <tr>\r\n  <td width=\"50%\">Patient Name  </td>\r\n  <td width=\"50%\">[name] ([patient_id]) </td>\r\n </tr>\r\n <tr>\r\n  <td>Date of birth</td>\r\n  <td valign=\"top\">[dob]</td>\r\n </tr>\r\n <tr>\r\n  <td>Age</td>\r\n  <td valign=\"top\">[age]</td>\r\n </tr>\r\n <tr>\r\n  <td>Gender</td>\r\n  <td valign=\"top\">[gender]</td>\r\n </tr>\r\n \r\n <tr>\r\n  <td>Phone</td>\r\n  <td valign=\"top\">[phone]</td>\r\n </tr>\r\n <tr>\r\n  <td>Guardian Name</td>\r\n  <td valign=\"top\">[guardian_name]</td>\r\n </tr>\r\n <tr>\r\n  <td>Address</td>\r\n  <td valign=\"top\">[address]</td>\r\n </tr>\r\n <tr>\r\n  <td>Email</td>\r\n  <td valign=\"top\">[email]</td>\r\n </tr>\r\n <tr>\r\n  <td>OPD/IPD NO</td>\r\n  <td valign=\"top\">[opd_ipd_no]</td>\r\n </tr>\r\n  <tr>\r\n  <td>OPD Checkup Id</td>\r\n  <td valign=\"top\">[opd_checkup_id]</td>\r\n </tr>\r\n <tr>\r\n  <td>Consultant Doctor</td>\r\n  <td valign=\"top\">[consultant_doctor]</td>\r\n </tr>\r\n</table>', '<h2>Patient Detail</h2>', '', '', '', '', '', 'certificate.jpg', 2, 1, 140, 300, 700, 600, 1, 200, NULL, '2021-10-29 04:28:45');