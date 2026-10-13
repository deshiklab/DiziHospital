# NGINX Installation

_Sat, 11 Mar, 2023_ · [Installation(7)](https://smart-hospital.in/category/getting-started/installation) · vendor article: https://smart-hospital.in/article/nginx-installation-1

### NGINX Installation

Sat, 11 Mar, 2023

[Articles](https://smart-hospital.in/articles)[Getting Started](https://smart-hospital.in/category/getting-started)[Installation](https://smart-hospital.in/category/installation)

---

We provide support only for **Linux with Apache hosting for Smart Hospital** so its highly recommended to use **Smart Hospital on LAMP (Linux, Apache, MySQL, PHP) based hosting**.  
  
Use the following configuration if you are installing **Smart Hospital on NGINX**. In the sample code config, there are some variables that you need to change manually based on your server.  
  
  

#### **Advanced Config**

```
server {
        listen Your_IP_ADDRESS_HERE:443 http2;
        # If you don't have http2 support, delete http2 here
            server_name domain.com http://www.domain.com;
            root /var/www/domain.com/;
            index index.php index.html index.htm;
            access_log /var/log/nginx/domains/domain.com.log combined;
            error_log /var/log/nginx/domains/domain.com.error.log error;
            add_header Strict-Transport-Security "max-age=31536000; includeSubdomains" always;
            add_header X-Frame-Options SAMEORIGIN;
            add_header X-Content-Type-Options nosniff;
            add_header X-XSS-Protection "1; mode=block";

        # If you dont want SSL, please remove ssl section below and add :80 instead of :443 on top server definition 
            ssl on;
            ssl_certificate /path/to/ssl.pem;
            ssl_certificate_key /path/to/ssl.key;
            ssl_session_timeout 5m;

        # To generate the following DHPARAM.PEM file, run first the following command on the server:
        # openssl dhparam -out /etc/ssl/certs/dhparam.pem 2048
        # Il will take at least 20 minutes!
        # If you don't want it, comment the following line 

            ssl_dhparam /etc/ssl/certs/dhparam.pem; 

            ssl_prefer_server_ciphers on;
            resolver 8.8.8.8;
            ssl_stapling on;
            ssl_trusted_certificate /path/to/ssl.pem;
            # same certificate as up


        location / {
            try_files $uri $uri/ /index.php?/$request_uri;
            add_header Strict-Transport-Security "max-age=31536000; includeSubdomains" always;
            add_header X-Frame-Options SAMEORIGIN;
            add_header X-Content-Type-Options nosniff;
            add_header X-XSS-Protection "1; mode=block";

            location ~* ^.+\.(jpeg|jpg|png|gif|bmp|ico|svg|css|js)$ {
            expires max;
        }

        location ~ [^/]\.php(/|$) {
            add_header Strict-Transport-Security "max-age=31536000; includeSubdomains" always;
            add_header X-Frame-Options SAMEORIGIN;
            add_header X-Content-Type-Options nosniff;
            add_header X-XSS-Protection "1; mode=block";
            fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
            if (!-f $document_root$fastcgi_script_name) {
            return 404;
        }
            fastcgi_read_timeout 300;
            fastcgi_pass 127.0.0.1:9002;
            fastcgi_index index.php;
            include /etc/nginx/fastcgi_params;
            # modify this path if OS flavor different than Ubuntu/Debian
        }
        
        location /backups {
		    deny all;
		    return 404;
        }

        # Optional, disallow access to this directories and folders
        location ~* "/\.(htaccess|htpasswd|git|svn)$" {
            deny all;
            return 404;
        }
    }
}
```

  

#### **Simple Config**

```
server {
        server_name yourdomain.com www.yourdomain.com;

        root /path/to/your/website.com/;
        index index.html index.php;

        # set expiration of assets to MAX for caching
        location ~* \.(ico|css|js|gif|jpe?g|png)(\?[0-9]+)?$ {
                expires max;
                log_not_found off;
        }

        location / {
                # Check if a file or directory index file exists, else route it to index.php.
                try_files $uri $uri/ /index.php;
        }
        
        location /backups {
                deny all;
                return 404;
        }

        location ~* \.php$ {
                fastcgi_pass 127.0.0.1:9000;
                include fastcgi.conf;
        }
}
```
