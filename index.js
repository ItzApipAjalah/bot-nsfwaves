require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

// Create a bot instance
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

// Initialize Supabase client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);

// Store user states and data
const userStates = new Map();
const userEmails = new Map();
const userDepositMessages = new Map();

// Function to generate random code
function generateRandomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Function to verify donation
async function verifyDonation(chatId) {
    try {
        // Get current balance first
        const { data: currentUser } = await supabase
            .from('user_donations')
            .select('total_koin')
            .eq('telegram_id', chatId)
            .single();

        const currentBalance = currentUser?.total_koin || 0;

        const response = await axios.get(process.env.TRAKTEER_API_URL, {
            params: {
                limit: 5,
                page: 1,
                include: ['supporter_email', 'updated_at_diff_label', 'order_id']
            },
            headers: {
                'Accept': 'application/json',
                'X-Requested-With': 'XMLHttpRequest',
                'key': process.env.TRAKTEER_API_KEY
            }
        });

        if (response.data.status === 'success' && response.data.result.data.length > 0) {
            const donations = response.data.result.data;
            let totalKoin = 0;
            let newOrders = [];

            for (const donation of donations) {
                // Check if the support message contains the user's telegram ID
                if (donation.support_message && donation.support_message.includes(chatId.toString())) {
                    // Check if order already exists
                    const { data: existingOrder } = await supabase
                        .from('donation_orders')
                        .select('order_id')
                        .eq('order_id', donation.order_id)
                        .single();

                    if (!existingOrder) {
                        const koinAmount = Math.floor(donation.amount / 15); // 1500 = 100 koin
                        totalKoin += koinAmount;
                        newOrders.push({
                            telegram_id: chatId,
                            order_id: donation.order_id,
                            amount: donation.amount,
                            koin_amount: koinAmount
                        });
                    }
                }
            }

            if (newOrders.length > 0) {
                // Insert new orders
                const { error: orderError } = await supabase
                    .from('donation_orders')
                    .insert(newOrders);

                if (orderError) throw orderError;

                // Update total koin
                const { error: updateError } = await supabase
                    .from('user_donations')
                    .update({ 
                        total_koin: currentBalance + totalKoin
                    })
                    .eq('telegram_id', chatId);

                if (updateError) throw updateError;

                return {
                    success: true,
                    newKoin: totalKoin,
                    totalKoin: currentBalance + totalKoin
                };
            }
        }
        return { 
            success: true, 
            newKoin: 0, 
            totalKoin: currentBalance 
        };
    } catch (error) {
        console.error('Error verifying donation:', error);
        return { success: false, error: error.message };
    }
}

// Function to escape special characters for MarkdownV2
function escapeMarkdown(text) {
    if (!text) return '';
    return text.toString()
        .replace(/\_/g, '\\_')
        .replace(/\*/g, '\\*')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)')
        .replace(/\~/g, '\\~')
        .replace(/\`/g, '\\`')
        .replace(/\>/g, '\\>')
        .replace(/\#/g, '\\#')
        .replace(/\+/g, '\\+')
        .replace(/\=/g, '\\=')
        .replace(/\|/g, '\\|')
        .replace(/\{/g, '\\{')
        .replace(/\}/g, '\\}')
        .replace(/\./g, '\\.')
        .replace(/\!/g, '\\!')
        .replace(/\-/g, '\\-');
}

// Handle /start command
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
    
    try {
        // Check if user exists in database
        const { data: userData, error } = await supabase
            .from('user_donations')
            .select('total_koin')
            .eq('telegram_id', chatId)
            .single();

        let welcomeMessage;
        let buttons = [];

        if (userData) {
            // User exists, show balance
            welcomeMessage = `Halo ${escapeMarkdown(username)}\\! Selamat datang kembali di Bot Nsfwaves\\!\n\n` +
                `💰 Saldo koin Anda: ${escapeMarkdown(userData.total_koin.toString())} koin\n\n` +
                `Saya dapat membantu Anda melakukan donasi melalui Nsfwaves\\.`;
            
            buttons = [
                [{ text: '👤 Profil Saya', callback_data: 'profile' }],
                [{ text: '💰 Deposit Koin', callback_data: 'deposit' }]
            ];
        } else {
            // New user
            welcomeMessage = `Halo ${escapeMarkdown(username)}\\! Selamat datang di Bot Nsfwaves\\!\n\nSaya dapat membantu Anda melakukan donasi melalui Nsfwaves\\.`;
            buttons = [
                [{ text: '👤 Profil Saya', callback_data: 'profile' }],
                [{ text: '💰 Deposit Koin', callback_data: 'deposit' }]
            ];
        }
        
        const options = {
            parse_mode: 'MarkdownV2',
            reply_markup: {
                inline_keyboard: buttons
            }
        };
        
        bot.sendMessage(chatId, welcomeMessage, options);
    } catch (error) {
        console.error('Error in /start command:', error);
        bot.sendMessage(chatId, '❌ Maaf, terjadi kesalahan\\. Silakan coba lagi nanti\\.', { parse_mode: 'MarkdownV2' });
    }
});

// Handle callback queries (button clicks)
bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;

    if (data === 'profile') {
        try {
            // Get user data from database
            const { data: userData, error } = await supabase
                .from('user_donations')
                .select('*')
                .eq('telegram_id', chatId)
                .single();

            if (error) throw error;

            // Get user info from Telegram
            const user = callbackQuery.from;
            const username = user.username ? `@${user.username}` : 'Tidak ada';
            const firstName = user.first_name || 'Tidak ada';
            const lastName = user.last_name || '';

            // Get donation history
            const { data: donationHistory, error: historyError } = await supabase
                .from('donation_orders')
                .select('amount, koin_amount, created_at')
                .eq('telegram_id', chatId)
                .order('created_at', { ascending: false })
                .limit(5);

            if (historyError) throw historyError;

            // Calculate total donations
            const totalDonations = donationHistory.reduce((sum, order) => sum + order.amount, 0);
            const totalKoinEarned = donationHistory.reduce((sum, order) => sum + order.koin_amount, 0);

            // Start building the profile message
            let profileMessage = `👤 *PROFIL PENGGUNA*\n\n` +
                `🆔 ID Telegram: \`${escapeMarkdown(chatId)}\`\n` +
                `👤 Nama: ${escapeMarkdown(firstName + ' ' + lastName)}\n` +
                `📱 Username: ${escapeMarkdown(username)}\n` +
                `💰 Saldo Koin: ${escapeMarkdown(userData.total_koin.toString())} koin\n\n` +
                `📊 *STATISTIK DONASI*\n` +
                `💵 Total Donasi: Rp ${escapeMarkdown(totalDonations.toString())}\n` +
                `🪙 Total Koin Diperoleh: ${escapeMarkdown(totalKoinEarned.toString())} koin\n\n` +
                `📜 *RIWAYAT DONASI TERAKHIR*\n`;

            // Add recent donation history
            if (donationHistory.length > 0) {
                donationHistory.forEach((order, index) => {
                    const date = new Date(order.created_at).toLocaleDateString('id-ID');
                    profileMessage += `${index + 1}\\. Rp ${escapeMarkdown(order.amount.toString())} \\(${escapeMarkdown(order.koin_amount.toString())} koin\\) \\- ${escapeMarkdown(date)}\n`;
                });
            } else {
                profileMessage += `Belum ada riwayat donasi\\.`;
            }

            const options = {
                parse_mode: 'MarkdownV2',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '💰 Deposit Koin', callback_data: 'deposit' }]
                    ]
                }
            };

            bot.sendMessage(chatId, profileMessage, options);
        } catch (error) {
            console.error('Error fetching profile:', error);
            bot.sendMessage(chatId, '❌ Maaf, terjadi kesalahan saat mengambil profil\\. Silakan coba lagi nanti\\.', { parse_mode: 'MarkdownV2' });
        }
    } else if (data === 'deposit') {
        try {
            // Get username from callback query
            const username = callbackQuery.from.username ? `@${callbackQuery.from.username}` : callbackQuery.from.first_name;

            // Delete old deposit message if exists
            const oldMessageId = userDepositMessages.get(chatId);
            if (oldMessageId) {
                try {
                    await bot.deleteMessage(chatId, oldMessageId);
                } catch (deleteError) {
                    console.error('Error deleting old message:', deleteError);
                }
            }

            // Check if user exists in database
            const { data: userData, error } = await supabase
                .from('user_donations')
                .select('total_koin')
                .eq('telegram_id', chatId)
                .single();

            if (error && error.code !== 'PGRST116') {
                throw error;
            }

            // Generate random code for this deposit
            const randomCode = generateRandomCode();
            const supportMessage = `${randomCode} ${chatId}`;

            if (userData) {
                // Update existing user's support message
                const { error: updateError } = await supabase
                    .from('user_donations')
                    .update({ support_message: supportMessage })
                    .eq('telegram_id', chatId);

                if (updateError) throw updateError;

                // User exists, show instructions
                const instructions = `✅ Selamat datang kembali ${escapeMarkdown(username)}\\!\\!\n` +
                    `💰 Saldo koin Anda: ${escapeMarkdown(userData.total_koin.toString())} koin\n\n` +
                    '📝 Silakan ikuti langkah\\-langkah berikut untuk menyelesaikan donasi Anda:\n\n' +
                    '1\\. Kunjungi https://nsfwaves\\.com\n' +
                    '2\\. Pilih jumlah donasi Anda\n' +
                    '3\\. Pada kolom pesan, masukkan teks berikut:\n' +
                    `\`${escapeMarkdown(supportMessage)}\`\n` +
                    '4\\. Selesaikan pembayaran Anda\n\n' +
                    '⚠️ Setelah pembayaran, klik "Verifikasi Donasi" untuk mendapatkan koin Anda\\!';
                
                const options = {
                    parse_mode: 'MarkdownV2',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📋 Salin Pesan', callback_data: `copy_${supportMessage}` }],
                            [{ text: '🔄 Verifikasi Donasi', callback_data: 'verify_donation' }]
                        ]
                    }
                };
                
                const sentMessage = await bot.sendMessage(chatId, instructions, options);
                userDepositMessages.set(chatId, sentMessage.message_id);
            } else {
                // Create new user with support message
                const { error: createError } = await supabase
                    .from('user_donations')
                    .insert({
                        telegram_id: chatId,
                        total_koin: 0,
                        support_message: supportMessage
                    });

                if (createError) throw createError;

                const instructions = `✅ Selamat datang di sistem donasi ${escapeMarkdown(username)}\\!\\!\n\n` +
                    '📝 Silakan ikuti langkah\\-langkah berikut untuk menyelesaikan donasi Anda:\n\n' +
                    '1\\. Kunjungi https://nsfwaves\\.com\n' +
                    '2\\. Pilih jumlah donasi Anda\n' +
                    '3\\. Pada kolom pesan, masukkan teks berikut:\n' +
                    `\`${escapeMarkdown(supportMessage)}\`\n` +
                    '4\\. Selesaikan pembayaran Anda\n\n' +
                    '⚠️ Setelah pembayaran, klik "Verifikasi Donasi" untuk mendapatkan koin Anda\\!';
                
                const options = {
                    parse_mode: 'MarkdownV2',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📋 Salin Pesan', callback_data: `copy_${supportMessage}` }],
                            [{ text: '🔄 Verifikasi Donasi', callback_data: 'verify_donation' }]
                        ]
                    }
                };
                
                const sentMessage = await bot.sendMessage(chatId, instructions, options);
                userDepositMessages.set(chatId, sentMessage.message_id);
            }
        } catch (error) {
            console.error('Error checking user:', error);
            bot.sendMessage(chatId, '❌ Maaf, terjadi kesalahan\\. Silakan coba lagi nanti\\.', { parse_mode: 'MarkdownV2' });
        }
    } else if (data.startsWith('copy_')) {
        // Handle copy button click
        const messageToCopy = data.replace('copy_', '');
        bot.answerCallbackQuery(callbackQuery.id, {
            text: 'Pesan berhasil disalin!',
            show_alert: true
        });
        // Send the message as a separate message that can be easily copied
        bot.sendMessage(chatId, `📋 Salin pesan berikut:\n\n\`${escapeMarkdown(messageToCopy)}\``, {
            parse_mode: 'MarkdownV2'
        });
    } else if (data === 'verify_donation') {
        try {
            // Get the stored support message from database
            const { data: userData, error } = await supabase
                .from('user_donations')
                .select('support_message')
                .eq('telegram_id', chatId)
                .single();

            if (error) throw error;
            if (!userData || !userData.support_message) {
                throw new Error('Support message not found');
            }

            const supportMessage = userData.support_message;

            // Edit the original message to show verification in progress
            const verifyingMessage = await bot.editMessageText('🔄 Memverifikasi donasi Anda\\.\\.\\.', {
                chat_id: chatId,
                message_id: callbackQuery.message.message_id,
                parse_mode: 'MarkdownV2'
            });
            
            const result = await verifyDonation(chatId);
            
            if (result.success) {
                if (result.newKoin > 0) {
                    // Remove the message from tracking
                    userDepositMessages.delete(chatId);
                    // Edit the message to show only success message
                    await bot.editMessageText(
                        `✅ *TRANSACTION SUCCESS\\!*\n\n` +
                        `💰 Koin baru ditambahkan: ${escapeMarkdown(result.newKoin.toString())}\n` +
                        `💰 Total saldo: ${escapeMarkdown(result.totalKoin.toString())} koin`,
                        {
                            chat_id: chatId,
                            message_id: callbackQuery.message.message_id,
                            parse_mode: 'MarkdownV2'
                        }
                    );
                } else {
                    // Edit the message to show no new donations with try again message
                    await bot.editMessageText(
                        `ℹ️ Tidak ada donasi baru yang ditemukan\\.\n` +
                        `💰 Saldo saat ini: ${escapeMarkdown(result.totalKoin.toString())} koin\n\n` +
                        `📝 Silakan ikuti langkah\\-langkah berikut untuk menyelesaikan donasi Anda:\n\n` +
                        `1\\. Kunjungi https://nsfwaves\\.com\n` +
                        `2\\. Pilih jumlah donasi Anda\n` +
                        `3\\. Pada kolom pesan, masukkan teks berikut:\n` +
                        `\`${escapeMarkdown(supportMessage)}\`\n` +
                        `4\\. Selesaikan pembayaran Anda\n\n` +
                        `⚠️ Setelah pembayaran, klik "Verifikasi Donasi" untuk mendapatkan koin Anda\\!`,
                        {
                            chat_id: chatId,
                            message_id: callbackQuery.message.message_id,
                            parse_mode: 'MarkdownV2',
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '📋 Salin Pesan', callback_data: `copy_${supportMessage}` }],
                                    [{ text: '🔄 Verifikasi Donasi', callback_data: 'verify_donation' }]
                                ]
                            }
                        }
                    );
                }
            } else {
                // Edit the message to show error
                await bot.editMessageText(
                    `❌ Gagal memverifikasi donasi\\. Silakan coba lagi nanti\\.`,
                    {
                        chat_id: chatId,
                        message_id: callbackQuery.message.message_id,
                        parse_mode: 'MarkdownV2'
                    }
                );
            }
        } catch (error) {
            console.error('Error in verification:', error);
            // Get the stored support message from database for error message
            const { data: userData } = await supabase
                .from('user_donations')
                .select('support_message')
                .eq('telegram_id', chatId)
                .single();

            const supportMessage = userData?.support_message || 'Pesan tidak ditemukan';
            
            // Edit the message to show error
            await bot.editMessageText(
                `❌ Maaf, terjadi kesalahan\\. Silakan coba lagi nanti\\.\n\n` +
                `📝 Silakan ikuti langkah\\-langkah berikut untuk menyelesaikan donasi Anda:\n\n` +
                `1\\. Kunjungi https://nsfwaves\\.com\n` +
                `2\\. Pilih jumlah donasi Anda\n` +
                `3\\. Pada kolom pesan, masukkan teks berikut:\n` +
                `\`${escapeMarkdown(supportMessage)}\`\n` +
                `4\\. Selesaikan pembayaran Anda\n\n` +
                `⚠️ Setelah pembayaran, klik "Verifikasi Donasi" untuk mendapatkan koin Anda\\!`,
                {
                    chat_id: chatId,
                    message_id: callbackQuery.message.message_id,
                    parse_mode: 'MarkdownV2',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📋 Salin Pesan', callback_data: `copy_${supportMessage}` }],
                            [{ text: '🔄 Verifikasi Donasi', callback_data: 'verify_donation' }]
                        ]
                    }
                }
            );
        }
    }
});

// Handle text messages
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    const userState = userStates.get(chatId);

    if (userState === 'waiting_for_email') {
        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (emailRegex.test(text)) {
            try {
                // Save user data to Supabase
                const { data, error } = await supabase
                    .from('user_donations')
                    .upsert({
                        telegram_id: chatId,
                        email: text,
                        total_koin: 0
                    }, {
                        onConflict: 'telegram_id'
                    });

                if (error) throw error;

                userEmails.set(chatId, text);
                userStates.delete(chatId);
                
                const instructions = `✅ Email diterima: ${text}\n\n` +
                    '📝 Silakan ikuti langkah\\-langkah berikut untuk menyelesaikan donasi Anda:\n\n' +
                    '1. Kunjungi https://nsfwaves.com\n' +
                    '2. Pilih jumlah donasi Anda\n' +
                    '3. Pada kolom pesan, masukkan email ini: ' + text + '\n' +
                    '4. Selesaikan pembayaran Anda\n\n' +
                    '⚠️ Penting: Pastikan untuk menggunakan alamat email yang sama dalam pesan donasi Anda!';
                
                const options = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🔄 Verifikasi Donasi', callback_data: 'verify_donation' }]
                        ]
                    }
                };
                
                bot.sendMessage(chatId, instructions, options);
            } catch (error) {
                console.error('Error saving to Supabase:', error);
                bot.sendMessage(chatId, '❌ Maaf, terjadi kesalahan\\. Silakan coba lagi nanti.');
            }
        } else {
            bot.sendMessage(chatId, '❌ Silakan masukkan alamat email yang valid:');
        }
    }
});

// Handle /profile command
bot.onText(/\/profile/, async (msg) => {
    const chatId = msg.chat.id;
    
    try {
        // Get user data from database
        const { data: userData, error } = await supabase
            .from('user_donations')
            .select('*')
            .eq('telegram_id', chatId)
            .single();

        if (error) throw error;

        // Get user info from Telegram
        const user = msg.from;
        const username = user.username ? `@${user.username}` : 'Tidak ada';
        const firstName = user.first_name || 'Tidak ada';
        const lastName = user.last_name || '';

        // Get donation history
        const { data: donationHistory, error: historyError } = await supabase
            .from('donation_orders')
            .select('amount, koin_amount, created_at')
            .eq('telegram_id', chatId)
            .order('created_at', { ascending: false })
            .limit(5);

        if (historyError) throw historyError;

        // Calculate total donations
        const totalDonations = donationHistory.reduce((sum, order) => sum + order.amount, 0);
        const totalKoinEarned = donationHistory.reduce((sum, order) => sum + order.koin_amount, 0);

        // Start building the profile message
        let profileMessage = `👤 *PROFIL PENGGUNA*\n\n` +
            `🆔 ID Telegram: \`${escapeMarkdown(chatId)}\`\n` +
            `👤 Nama: ${escapeMarkdown(firstName + ' ' + lastName)}\n` +
            `📱 Username: ${escapeMarkdown(username)}\n` +
            `💰 Saldo Koin: ${escapeMarkdown(userData.total_koin.toString())} koin\n\n` +
            `📊 *STATISTIK DONASI*\n` +
            `💵 Total Donasi: Rp ${escapeMarkdown(totalDonations.toString())}\n` +
            `🪙 Total Koin Diperoleh: ${escapeMarkdown(totalKoinEarned.toString())} koin\n\n` +
            `📜 *RIWAYAT DONASI TERAKHIR*\n`;

        // Add recent donation history
        if (donationHistory.length > 0) {
            donationHistory.forEach((order, index) => {
                const date = new Date(order.created_at).toLocaleDateString('id-ID');
                profileMessage += `${index + 1}\\. Rp ${escapeMarkdown(order.amount.toString())} \\(${escapeMarkdown(order.koin_amount.toString())} koin\\) \\- ${escapeMarkdown(date)}\n`;
            });
        } else {
            profileMessage += `Belum ada riwayat donasi\\.`;
        }

        const options = {
            parse_mode: 'MarkdownV2',
            reply_markup: {
                inline_keyboard: [
                    [{ text: '💰 Deposit Koin', callback_data: 'deposit' }]
                ]
            }
        };

        bot.sendMessage(chatId, profileMessage, options);
    } catch (error) {
        console.error('Error fetching profile:', error);
        bot.sendMessage(chatId, '❌ Maaf, terjadi kesalahan saat mengambil profil\\. Silakan coba lagi nanti\\.', { parse_mode: 'MarkdownV2' });
    }
});

// Handle /deposit command
bot.onText(/\/deposit/, async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
    
    try {
        // Delete old deposit message if exists
        const oldMessageId = userDepositMessages.get(chatId);
        if (oldMessageId) {
            try {
                await bot.deleteMessage(chatId, oldMessageId);
            } catch (deleteError) {
                console.error('Error deleting old message:', deleteError);
            }
        }

        // Check if user exists in database
        const { data: userData, error } = await supabase
            .from('user_donations')
            .select('total_koin')
            .eq('telegram_id', chatId)
            .single();

        if (error && error.code !== 'PGRST116') {
            throw error;
        }

        // Generate random code for this deposit
        const randomCode = generateRandomCode();
        const supportMessage = `${randomCode} ${chatId}`;

        if (userData) {
            // Update existing user's support message
            const { error: updateError } = await supabase
                .from('user_donations')
                .update({ support_message: supportMessage })
                .eq('telegram_id', chatId);

            if (updateError) throw updateError;

            // User exists, show instructions
            const instructions = `✅ Selamat datang kembali ${escapeMarkdown(username)}\\!\\!\n` +
                `💰 Saldo koin Anda: ${escapeMarkdown(userData.total_koin.toString())} koin\n\n` +
                '📝 Silakan ikuti langkah\\-langkah berikut untuk menyelesaikan donasi Anda:\n\n' +
                '1\\. Kunjungi https://nsfwaves\\.com\n' +
                '2\\. Pilih jumlah donasi Anda\n' +
                '3\\. Pada kolom pesan, masukkan teks berikut:\n' +
                `\`${escapeMarkdown(supportMessage)}\`\n` +
                '4\\. Selesaikan pembayaran Anda\n\n' +
                '⚠️ Setelah pembayaran, klik "Verifikasi Donasi" untuk mendapatkan koin Anda\\!';
            
            const options = {
                parse_mode: 'MarkdownV2',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📋 Salin Pesan', callback_data: `copy_${supportMessage}` }],
                        [{ text: '🔄 Verifikasi Donasi', callback_data: 'verify_donation' }]
                    ]
                }
            };
            
            const sentMessage = await bot.sendMessage(chatId, instructions, options);
            userDepositMessages.set(chatId, sentMessage.message_id);
        } else {
            // Create new user with support message
            const { error: createError } = await supabase
                .from('user_donations')
                .insert({
                    telegram_id: chatId,
                    total_koin: 0,
                    support_message: supportMessage
                });

            if (createError) throw createError;

            const instructions = `✅ Selamat datang di sistem donasi ${escapeMarkdown(username)}\\!\\!\n\n` +
                '📝 Silakan ikuti langkah\\-langkah berikut untuk menyelesaikan donasi Anda:\n\n' +
                '1\\. Kunjungi https://nsfwaves\\.com\n' +
                '2\\. Pilih jumlah donasi Anda\n' +
                '3\\. Pada kolom pesan, masukkan teks berikut:\n' +
                `\`${escapeMarkdown(supportMessage)}\`\n` +
                '4\\. Selesaikan pembayaran Anda\n\n' +
                '⚠️ Setelah pembayaran, klik "Verifikasi Donasi" untuk mendapatkan koin Anda\\!';
            
            const options = {
                parse_mode: 'MarkdownV2',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📋 Salin Pesan', callback_data: `copy_${supportMessage}` }],
                        [{ text: '🔄 Verifikasi Donasi', callback_data: 'verify_donation' }]
                    ]
                }
            };
            
            const sentMessage = await bot.sendMessage(chatId, instructions, options);
            userDepositMessages.set(chatId, sentMessage.message_id);
        }
    } catch (error) {
        console.error('Error checking user:', error);
        bot.sendMessage(chatId, '❌ Maaf, terjadi kesalahan\\. Silakan coba lagi nanti\\.', { parse_mode: 'MarkdownV2' });
    }
});

console.log('Bot is running...'); 