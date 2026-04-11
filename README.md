# Xodimlar Reyting Tizimi

## O'rnatish ketma-ketligi (Step by Step)

### 1. Node.js o'rnatish (agar yo'q bo'lsa)
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version  # v20.x ko'rinishi kerak
```

### 2. Loyihani serverga yuklash
```bash
# Fayllarni serverga ko'chirish (scp yoki git orqali)
scp -r rating-app-new/ user@server:/home/user/rating-app
# yoki
git clone <repo-url> /home/user/rating-app
```

### 3. Papkaga kirish va paketlarni o'rnatish
```bash
cd /home/user/rating-app
npm install
```

### 4. Ma'lumotlar bazasi uchun doimiy papka yaratish
```bash
# Bu papka server qayta ishga tushsa ham yo'qolmaydi
mkdir -p /home/user/rating-data
```

### 5. Ilovani ishga tushirish (oddiy test)
```bash
DB_PATH=/home/user/rating-data/rating.db PORT=3000 node server.js
```

### 6. PM2 bilan doimiy ishlatish (tavsiya etiladi)
PM2 — server o'chsa avtomatik qayta ishga tushiradi.

```bash
# PM2 o'rnatish
npm install -g pm2

# Ilovani PM2 bilan ishga tushirish
DB_PATH=/home/user/rating-data/rating.db PORT=3000 pm2 start server.js --name rating-app

# Server qayta yoqilganda ham avtomatik ishlasin
pm2 startup
pm2 save

# Holat tekshirish
pm2 status
pm2 logs rating-app
```

### 7. PM2 buyruqlari
```bash
pm2 restart rating-app   # qayta ishga tushirish
pm2 stop rating-app      # to'xtatish
pm2 delete rating-app    # o'chirish
pm2 logs rating-app      # loglarni ko'rish
```

### 8. Nginx orqali 80-portga ulash (ixtiyoriy)
```bash
sudo apt install nginx -y
sudo nano /etc/nginx/sites-available/rating
```

Fayl ichiga:
```nginx
server {
    listen 80;
    server_name sizning-domen.uz;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/rating /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

## Ma'lumot xavfsizligi haqida
- Database fayli: `/home/user/rating-data/rating.db`
- WAL (Write-Ahead Logging) rejimi yoqilgan — elektr uzilsa ham ma'lumot yo'qolmaydi
- Server qayta ishga tushsa PM2 avtomatik ko'taradi, DB_PATH o'zgaruvchisi orqali doimiy papkaga yo'naltirilgan

## Muhit o'zgaruvchilari
| O'zgaruvchi | Default | Izoh |
|---|---|---|
| PORT | 3000 | Server porti |
| DB_PATH | ./db/rating.db | SQLite fayl yo'li |
