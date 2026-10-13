# Enabling SSL In Smart Hospital

_Tue, 09 Nov, 2021_ · [Common Issues & Troubleshooting (13)](https://smart-hospital.in/category/common-issues-troubleshooting) · vendor article: https://smart-hospital.in/article/enabling-ssl-in-smart-hospital

### Enabling SSL In Smart Hospital

Tue, 09 Nov, 2021

[Articles](https://smart-hospital.in/articles)[Common Issues & Troubleshooting](https://smart-hospital.in/category/common-issues-troubleshooting)

---

After installing ssl on your Smart Hospital hosting you need to edit your base url in following file -  
  
Open file **\application\config\config.php** and find the line `$config['base_url'] = 'http://yourdomain.com/';` change it to `$config['base_url'] = 'https://yourdomain.com/';` that's it.
