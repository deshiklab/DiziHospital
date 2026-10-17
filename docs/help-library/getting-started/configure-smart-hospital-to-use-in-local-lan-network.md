# Configure Smart Hospital To Use In Local LAN Network

_Mon, 07 Feb, 2022_ · [Getting Started (3)](https://smart-hospital.in/category/getting-started) · vendor article: https://smart-hospital.in/article/configure-smart-hospital-to-use-in-local-lan-network

### Configure Smart Hospital To Use In Local LAN Network

Mon, 07 Feb, 2022

[Articles](https://smart-hospital.in/articles)[Getting Started](https://smart-hospital.in/category/getting-started)

---

If you have hosted Smart Hospital on your local server and want to use in local LAN (Local Area Network) network then your Smart Hospital hosting machine should have static ip address (not be dynamic assigned by your modem DHCP). Here suppose your server hosting machine have ip address **192.168.1.2** then when you are installing Smart Hospital you should type **192.168.1.2/myhospital/** not **localhost/myhospital/** in browser address bar otherwise you cannot access Smart Hospital from other computers in your LAN and will redirect to **localhost/myhospital/** url.   
  
If you have already installed Smart Hospital using **localhost/myhospital/** then you can correct this by editing **base\_url** value in file **/application/config/config.php** . In this file change **localhost** to your hosting server **static ip** address like **192.168.1.2** .
