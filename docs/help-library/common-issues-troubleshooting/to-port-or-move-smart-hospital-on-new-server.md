# To Port Or Move Smart Hospital On New Server

_Mon, 18 Oct, 2021_ · [Common Issues & Troubleshooting (13)](https://smart-hospital.in/category/common-issues-troubleshooting) · vendor article: https://smart-hospital.in/article/to-port-or-move-smart-hospital-on-new-server

### To Port Or Move Smart Hospital On New Server

Mon, 18 Oct, 2021

[Articles](https://smart-hospital.in/articles)[Common Issues & Troubleshooting](https://smart-hospital.in/category/common-issues-troubleshooting)

---

To port or move Smart Hospital on new server/hosting/url you have to do change in two files -  
  
1. Open file **\application\config\config.php** and find line **`$config['base_url'] = 'http://yourdonamin.com/';`** change here to new url name where you want to move Smart Hospital.  
  
2. Open file **\application\config\database.php** and find following lines -  
  
`'hostname' => '',`  
`'username' => '',`  
`'password' => '',`  
`'database' => '',`  
  
Change new database details in above lines.
