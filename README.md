# Bot Nsfwaves

Bot Telegram untuk mengelola donasi dan sistem koin di Nsfwaves.

## Fitur

- 💰 Sistem deposit koin
- 👤 Profil pengguna dengan riwayat donasi
- 🔄 Verifikasi donasi otomatis
- 📊 Statistik donasi
- 💳 Integrasi dengan Nsfwaves

## Persyaratan

- Node.js (v14 atau lebih baru)
- PostgreSQL (melalui Supabase)
- Token Bot Telegram
- Akun Supabase
- API Key Trakteer

## Instalasi

1. Clone repository ini:
```bash
git clone https://github.com/ItzApipAjalah/bot-nsfwaves.git
cd bot-nsfwaves
```

2. Install dependencies:
```bash
npm install
```

3. Buat file `.env` dan isi dengan konfigurasi berikut:
```env
# Telegram Bot Token
BOT_TOKEN=your_telegram_bot_token

# Supabase Configuration
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key

# Trakteer API Configuration
TRAKTEER_API_KEY=your_trakteer_api_key
TRAKTEER_API_URL=https://api.trakteer.id/v1/public/supports
```

4. Jalankan bot:
```bash
node index.js
```

## Struktur Database

### Tabel `user_donations`
- `telegram_id` (text) - ID Telegram pengguna
- `total_koin` (integer) - Total koin pengguna
- `support_message` (text) - Pesan dukungan untuk verifikasi

### Tabel `donation_orders`
- `telegram_id` (text) - ID Telegram pengguna
- `order_id` (text) - ID pesanan donasi
- `amount` (integer) - Jumlah donasi
- `koin_amount` (integer) - Jumlah koin yang diterima
- `created_at` (timestamp) - Waktu pembuatan pesanan

## Penggunaan

1. Mulai bot dengan perintah `/start`
2. Gunakan menu untuk:
   - Melihat profil (`/profile`)
   - Melakukan deposit (`/deposit`)
   - Memverifikasi donasi

## Lisensi

[MIT](https://choosealicense.com/licenses/mit/) 