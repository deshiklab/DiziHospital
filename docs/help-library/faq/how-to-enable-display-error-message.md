# How to enable display error message?

_Mon, 18 Oct, 2021_ · [FAQ (17)](https://smart-hospital.in/category/faq) · vendor article: https://smart-hospital.in/article/how-to-enable-display-error-message

### How to enable display error message?

Mon, 18 Oct, 2021

[Articles](https://smart-hospital.in/articles)[FAQ](https://smart-hospital.in/category/faq)

---

By default display error messages are disabled in Smart Hospital that is the reason every time if there is any error occurred system is showing 500 error message. This is due to Smart Hospital environment is set for production . To enable display error message you should change Smart Hospital environment from **production** to **development**.  
  
Please do the following changes in code files to change environment -  
  
Open file **\index.php** in any editor carefully from your installation folder and find  
  
`define('ENVIRONMENT', 'production');`  
  
and change it to  
  
`define('ENVIRONMENT', 'development');`  
  
  
Be aware that in development mode you may see some errors and deprecation warnings, for this reason, it’s always recommended to set the environment to “production” .  
  

|  |
| --- |
| **Do not forget to turn it back to production when you have finished the error checking or debugging** |
