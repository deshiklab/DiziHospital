# IIS - Windows Server Installation

_Mon, 18 Oct, 2021_ · [Installation(7)](https://smart-hospital.in/category/getting-started/installation) · vendor article: https://smart-hospital.in/article/iis-windows-server-installation-1

### IIS - Windows Server Installation

Mon, 18 Oct, 2021

[Articles](https://smart-hospital.in/articles)[Getting Started](https://smart-hospital.in/category/getting-started)[Installation](https://smart-hospital.in/category/installation)

---

Using **Windows based IIS Web Server** hosting which **is not recommended** to use Smart Hospital. We provide support only for **Linux with Apache hosting for Smart Hospital** so its highly recommended to use **Smart Hospital on LAMP (Linux, Apache, MySQL, PHP) based hosting**.  
  
**mod\_rewrite** should be enabled on your hosting before installing Smart Hospital.  
  
Place the **web.config** file in the folder where you are trying to install Smart Hospital.  
Use the following **web.config** file to install on IIS server.  
  

```
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
    <system.webServer>
        <rewrite>
            <rules>
                <rule name="Imported Rule 1" stopProcessing="true">
                    <match url="^(.*)$" ignoreCase="false" />
                        <conditions logicalGrouping="MatchAll">
                            <add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
                            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
                        </conditions>
                        <action type="Rewrite" url="index.php?url={R:1}" appendQueryString="true" />
                </rule>
            </rules>
        </rewrite>
    </system.webServer>
</configuration>
```

  
If this web.config doesn’t work try the following -  
  

```
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
	<system.webServer>
		<asp scriptErrorSentToBrowser="true" />
		<httpErrors existingResponse="PassThrough" errorMode="Detailed"></httpErrors>
		<rewrite>
			<rules>
				<rule name="Imported Rule 1" stopProcessing="true">
					<match url="^(.*)$" ignoreCase="false" />
					<conditions logicalGrouping="MatchAll">
						<add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true" />
						<add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true" />
					</conditions>
					<action type="Rewrite" url="index.php?url={R:1}" appendQueryString="true" />
				</rule>
			</rules>
		</rewrite>
	</system.webServer>
	<system.web>
		<customErrors mode="Off"/>
		<compilation debug="true"/>
	</system.web>
</configuration>
```

  
If you are installing Smart Hospital in a subfolder or in a subdomain and both web.config files above doesn’t work, please try this web.config file -  
  

```
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
	  	<clear />
			<rule name="MainFolder" patternSyntax="Wildcard">
				<match url="*"/>
					<conditions>
						<add input="{REQUEST_FILENAME}" matchType="IsFile" negate="true"/>
						<add input="{REQUEST_FILENAME}" matchType="IsDirectory" negate="true"/>
					</conditions>
				<action type="Rewrite" url="index.php"/>
			</rule>
		</rules>
    </rewrite>
  </system.webServer>
</configuration>
```

  
After this start Smart Hospital installation and follow the steps.
