require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
// デフォルトのInvidiousインスタンスを設定。環境変数で上書き可能。
const INVIDIOUS_INSTANCE = process.env.INVIDIOUS_INSTANCE || 'https://lekker.gay';

// CORSを有効にし、JSONボディをパースできるように設定
app.use(cors());
app.use(express.json());

// --- ヘルパー関数 ---

// HTML要素からテキストを安全に取得する関数
const getText = ($, selector) => {
    const element = $(selector);
    return element.length ? element.text().trim() : null;
};

// HTML要素から属性を安全に取得する関数
const getAttr = ($, selector, attr) => {
    const element = $(selector);
    return element.length ? element.attr(attr) : null;
};

// Invidiousの相対URLを絶対URLに変換する関数
const getAbsoluteUrl = (path) => {
    if (!path) return null;
    if (path.startsWith('http://') || path.startsWith('https://')) {
        return path;
    }
    // スラッシュの重複を避けるために条件分岐
    return `${INVIDIOUS_INSTANCE}${path.startsWith('/') ? '' : '/'}${path}`;
};

// --- APIエンドポイント ---

// 1. 人気動画の取得
app.get('/api/popular', async (req, res) => {
    try {
        const url = `${INVIDIOUS_INSTANCE}/feed/popular`;
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);

        const popularVideos = [];
        $('.pure-g.loop > .pure-u-1').each((i, element) => {
            const videoId = getAttr($(element).find('h3 a'), 'href')?.split('v=')[1];
            if (!videoId) return; // videoIdがない場合はスキップ

            popularVideos.push({
                title: getText($(element).find('h3 a')),
                videoId: videoId,
                thumbnail: getAttr($(element).find('img'), 'src'),
                author: getText($(element).find('.channel-name')),
                views: getText($(element).find('.stat:contains("views")')),
                uploadedAt: getText($(element).find('.stat:contains("ago")')),
                url: getAbsoluteUrl(getAttr($(element).find('h3 a'), 'href'))
            });
        });
        res.json(popularVideos);
    } catch (error) {
        console.error('Error fetching popular videos:', error);
        res.status(500).json({ error: 'Failed to fetch popular videos' });
    }
});

// 2. 検索結果の取得
app.get('/api/search', async (req, res) => {
    const { q } = req.query; // クエリパラメータ 'q' を取得
    if (!q) {
        return res.status(400).json({ error: 'Query parameter "q" is required.' });
    }

    try {
        const url = `${INVIDIOUS_INSTANCE}/search?q=${encodeURIComponent(q)}`;
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);

        const searchResults = [];
        $('.pure-g.loop > .pure-u-1').each((i, element) => {
            const videoId = getAttr($(element).find('h3 a'), 'href')?.split('v=')[1];
            if (!videoId) return;

            searchResults.push({
                title: getText($(element).find('h3 a')),
                videoId: videoId,
                thumbnail: getAttr($(element).find('img'), 'src'),
                author: getText($(element).find('.channel-name')),
                views: getText($(element).find('.stat:contains("views")')),
                uploadedAt: getText($(element).find('.stat:contains("ago")')),
                url: getAbsoluteUrl(getAttr($(element).find('h3 a'), 'href'))
            });
        });
        res.json(searchResults);
    } catch (error) {
        console.error('Error fetching search results:', error);
        res.status(500).json({ error: 'Failed to fetch search results' });
    }
});

// 3. 動画情報の取得 (フォーマットURLを含む)
app.get('/api/video/:videoId', async (req, res) => {
    const { videoId } = req.params; // URLパスパラメータからvideoIdを取得
    if (!videoId) {
        return res.status(400).json({ error: 'Video ID is required.' });
    }

    try {
        const url = `${INVIDIOUS_INSTANCE}/watch?v=${encodeURIComponent(videoId)}`;
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);

        const formats = [];
        // Invidiousのダウンロードリンクを検索し、フォーマット情報を抽出
        $('a.pure-button.pure-button-primary').each((i, element) => {
            const href = getAttr($(element), 'href');
            const text = getText($(element));
            if (href && text && text.includes('Download')) {
                const formatInfo = text.replace('Download ', ''); // "Download " を除去してフォーマット情報のみ取得
                formats.push({
                    format: formatInfo,
                    url: getAbsoluteUrl(href)
                });
            }
        });

        const videoInfo = {
            title: getText($('.video-title')),
            author: getText($('.channel-name')),
            views: getText($('.stat:contains("views")')),
            uploadedAt: getText($('.stat:contains("ago")')),
            description: getText($('#description')),
            formats: formats, // 取得したフォーマットURLのリスト
            invidiousWatchUrl: url // 念のためInvidiousの視聴URLも保持
        };

        res.json(videoInfo);
    } catch (error) {
        console.error(`Error fetching video info for ${videoId}:`, error);
        res.status(500).json({ error: 'Failed to fetch video information' });
    }
});

// 4. コメントの取得
app.get('/api/comments/:videoId', async (req, res) => {
    const { videoId } = req.params; // URLパスパラメータからvideoIdを取得
    if (!videoId) {
        return res.status(400).json({ error: 'Video ID is required.' });
    }

    try {
        const url = `${INVIDIOUS_INSTANCE}/comments/${encodeURIComponent(videoId)}`;
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);

        const comments = [];
        $('.comment-wrapper').each((i, element) => {
            comments.push({
                author: getText($(element).find('.comment-author')),
                text: getText($(element).find('.comment-content')),
                time: getText($(element).find('.comment-header .time')),
                likes: getText($(element).find('.comment-header .likes')),
            });
        });
        res.json(comments);
    } catch (error) {
        console.error(`Error fetching comments for ${videoId}:`, error);
        res.status(500).json({ error: 'Failed to fetch comments' });
    }
});

// ヘルスチェックエンドポイント (Vercelなどでサーバーが稼働しているか確認用)
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// サーバーの起動
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Using Invidious instance: ${INVIDIOUS_INSTANCE}`);
});
