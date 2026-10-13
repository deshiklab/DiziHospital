# Email Send Not Working

_Thu, 07 Aug, 2025_ · [Common Issues & Troubleshooting (13)](https://smart-hospital.in/category/common-issues-troubleshooting) · vendor article: https://smart-hospital.in/article/email-send-not-working

### Email Send Not Working

Thu, 07 Aug, 2025

[Articles](https://smart-hospital.in/articles)[Common Issues & Troubleshooting](https://smart-hospital.in/category/common-issues-troubleshooting)

---

After adding patient or staff if you found there is no email is sending by system then there may be email configuration issue on your server / Smart Hospital.  
  
In Smart Hospital we have used phpmailer **<https://github.com/PHPMailer/PHPMailer>**library which is used by many popular php application like WordPress, Drupal, SugarCRM, Yii, Joomla etc.  
  
  
By default **SendMail** is set as **Email Engine** in **Setup > Settings > Email Setting**. SendMail can only work and send emails if you cpanel hosting supports it. If SendMail not sending email then contact to your hosting provider. Since SendMail is easiest but less reliable so check email recipient account **Spam** folder because sometimes SendMail sent emails detected as spams (if using SendMail). Another and best option is to use **SMTP** as email engine. You can use **Gmail** or any other free SMTP service provider to use SMTP email engine.  
u200b  
If you are using your hosting smtp or any other provider smtp service then check their documentation for smtp settings.  
  
**By using below link you can setup the security setting:-**  
  
<https://www.google.com/account/about/?hl=en-US>   
  
  
1. **Security**  
  
![](../assets/email-send-not-working/1.jpg)  
  
  
2. **2 Step Verification**  
  
![](../assets/email-send-not-working/2.jpg)  
  
  
3. **App passwords  
  
![](../assets/email-send-not-working/3.jpg)**  
  
  
  
  
**Gmail SMTP configuration -**  
  
To configure gmail account first you have to create app password for SMTP service, Please check following setps to generate app password-  
  
1. Go to your Google Account.  
2. On the left navigation panel, choose Security.  
3. On the 'Signing in to Google' panel, choose App passwords. If you don’t see this option:  

* 2-Step Verification is not set up for your account
* 2-Step Verification is set up for security keys only
* Your account is through work, hospital or other organization
* You’ve turned on Advanced Protection for your account

4. At the bottom, choose Select app and choose the app that you’re using.  
5. Choose Select device and choose the device that you're using.  
6. Choose Generate.  
7. Follow the instructions to enter the app password. The app password is the 16-character code in the yellow bar on your device.  
8. Choose Done.  
  
  
After generating gmail app password for SMTP service enter credentials in Smart Hospital SMTP email configuration-  
  
**`SMTP Username = your gmail email id`**  
**`SMTP Password = Generated App Password`**  
**`SMTP Server = smtp.gmail.com`**  
**`SMTP Port = 587`**  
**`SMTP Security = TLS  
SMTP Auth = ON`**  
  
  
  
***Note: After configuring email setting please check you have enabled email notification settings from Setup > Settings > Notification Setting.***
