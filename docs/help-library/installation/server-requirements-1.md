# Server Requirements

_Mon, 23 Sep, 2024_ · [Installation(7)](https://smart-hospital.in/category/getting-started/installation) · vendor article: https://smart-hospital.in/article/server-requirements-1

### Server Requirements

Mon, 23 Sep, 2024

[Articles](https://smart-hospital.in/articles)[Getting Started](https://smart-hospital.in/category/getting-started)[Installation](https://smart-hospital.in/category/installation)

---

To installing **Smart Hospital**, Your web server must be running **PHP 7.0 or higher** and **Mysql 5.1 or higher**. We have tested it with Windows, Mac and Linux but for optimum performance we will recommend to use **Linux with Apache webserver**. Below are a list of items you should ensure your host can comply with.

* **PHP 8.1 to higher**
* **MYSQL 5.5 or higher (MYSQL 8 supported)**
* **MYSQL SQL\_MODE must not contain ONLY\_FULL\_GROUP\_BY**
* **mod\_rewrite Apache**
* **MBString Extension**
* **MYSQLi Extension**
* **Zip Extension**
* **CURL Extension (recommended)**
* **PHP max\_execution\_time should be atleast 60 seconds for smoother installation**
\* In most hosting accounts, these extensions are enabled by default. But you should check with your hosting provider.

Before installation **Smart Hospital** to install and work properly, you must make few directories/files writable. Below are a list of directories/files you should ensure that have write permissions.

* **installation\_dir/application/config/config.php**
* **installation\_dir/application/config/database.php**
* **installation\_dir/application/config/autoload.php**
* **installation\_dir/application/config/license.php**
* **installation\_dir/temp**
* **installation\_dir/backup**
* **installation\_dir/backup/database\_backup**
* **installation\_dir/backup/temp\_uploaded**
* **installation\_dir/uploads**
* **installation\_dir/uploads/<all\_its\_sub\_directories>**
