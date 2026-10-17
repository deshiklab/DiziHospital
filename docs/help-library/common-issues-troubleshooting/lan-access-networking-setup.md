# LAN Access Networking Setup

_Mon, 18 Oct, 2021_ · [Common Issues & Troubleshooting (13)](https://smart-hospital.in/category/common-issues-troubleshooting) · vendor article: https://smart-hospital.in/article/lan-access-networking-setup

### LAN Access Networking Setup

Mon, 18 Oct, 2021

[Articles](https://smart-hospital.in/articles)[Common Issues & Troubleshooting](https://smart-hospital.in/category/common-issues-troubleshooting)

---

If you have hosted Smart Hospital on your local server and want to use in local LAN network then your Smart Hospital hosting machine should have static ip address (not be dynamic assigned by your modem DHCP). Here suppose your server hosting machine have ip address **192.168.1.2** then when you are installing Smart Hospital then you should type **192.168.1.2/myhospital/** not **localhost/myhospital/** other wise you can not access Smart Hospital from other computers in your LAN and will redirect to **localhost/myhospital/** url. Now if you have installed Smart Hospital using **localhost/myhospital/** then you can correct this by editing base\_url value in file **/application/config/config.php** . In this file change **localhost** to your hosting server static ip address like **192.168.1.2** .
