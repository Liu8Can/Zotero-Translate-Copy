/*
 * ZOTERO 条目翻译器 - 最终发布版 v1.0  
 * @哔哩哔哩：沧浪同学 https://space.bilibili.com/520050693
 * 这是一个功能完善且高度可配置的脚本，可以一键翻译Zotero中的中文条目，
 * 并自动创建一个包含英文元数据的新条目副本。
 */

// ===================================================================
//                        --- 用户配置区 ---
//      将下面的值设置为 `true` (开启) 或 `false` (关闭) 来控制相应功能
// ===================================================================

// 选择翻译服务: 'bing' 或 'google'
const TRANSLATE_SERVICE = 'bing';

// 启用"关联"功能：在原始条目和翻译后的条目之间，创建一个可互相点击的"关联"链接。
const ENABLE_RELATION_LINK = true;

// 启用"短标题回链"：将原始的中文标题，添加到新条目的"短标题"字段中，方便快速识别和对照。
const ENABLE_SHORT_TITLE_LINK = true;

// 启用"摘要"翻译：翻译原文的摘要部分。由于摘要通常很长，关闭此项可以显著加快脚本运行速度。
const ENABLE_ABSTRACT_TRANSLATION = true;

// 启用"标签"功能：为翻译后的条目添加"Translated_Copy"标签，方便识别和筛选。
const ENABLE_TAGS = true;

// ===================================================================
//                      --- 配置区结束 ---
//                (通常无需修改此行下方的代码)
// ===================================================================


// --- 核心脚本逻辑 ---

const SOURCE_LANG = 'zh-CN';
const TARGET_LANG = 'en';
const TAG_FOR_TRANSLATED = 'Translated_Copy';
const MAX_RETRIES = 3;

// 获取 Bing 翻译的令牌
async function getBingToken() {
    try {
        const response = await Zotero.HTTP.request(
            'GET',
            'https://edge.microsoft.com/translate/auth',
            {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36 Edg/113.0.1774.42',
                }
            }
        );
        if (response.status === 200 && response.responseText) {
            return response.responseText;
        }
        throw new Error('获取令牌失败');
    } catch (e) {
        Zotero.debug('获取 Bing 翻译令牌失败: ' + e);
        throw e;
    }
}

// Bing 翻译实现
async function translateTextBing(text) {
    if (!text || typeof text !== 'string' || !text.trim()) return text;
    
    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            const token = await getBingToken();
            const response = await Zotero.HTTP.request(
                'POST',
                `https://api-edge.cognitive.microsofttranslator.com/translate?from=${SOURCE_LANG}&to=${TARGET_LANG}&api-version=3.0&includeSentenceLength=true`,
                {
                    headers: {
                        'accept': '*/*',
                        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
                        'authorization': `Bearer ${token}`,
                        'content-type': 'application/json',
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36 Edg/113.0.1774.42',
                    },
                    body: JSON.stringify([{ text: text }]),
                    responseType: 'json'
                }
            );

            if (response.status === 200 && response.response) {
                return response.response[0].translations[0].text;
            }
        } catch (e) {
            Zotero.debug(`Bing 翻译尝试 ${i + 1} 次失败: ${e}`);
        }
        if (i < MAX_RETRIES - 1) await Zotero.Promise.delay(300 * (i + 1));
    }
    return `[翻译失败] ${text}`;
}

// Google 翻译实现
async function translateTextGoogle(text) {
    if (!text || typeof text !== 'string' || !text.trim()) return text;
    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${SOURCE_LANG}&tl=${TARGET_LANG}&dt=t&q=${encodeURIComponent(text)}`;
            const res = await Zotero.HTTP.request('GET', url);
            if (res.status === 200 && res.responseText) {
                const json = JSON.parse(res.responseText);
                if (json && json[0]) return json[0].map(segment => segment[0]).join('');
            }
        } catch (e) { Zotero.debug(`Google 翻译尝试 ${i + 1} 次失败: ${e}`); }
        if (i < MAX_RETRIES - 1) await Zotero.Promise.delay(300 * (i + 1));
    }
    return `[翻译失败] ${text}`;
}

// 根据配置选择翻译服务
async function translateText(text) {
    return TRANSLATE_SERVICE === 'bing' ? translateTextBing(text) : translateTextGoogle(text);
}

async function main() {
    const items = Zotero.getActiveZoteroPane().getSelectedItems();
    if (!items.length) return "请先选择一个或多个需要翻译的条目。";

    let translatedCount = 0;
    const userID = Zotero.Libraries.userLibraryID;
    const newItems = [];

    for (const item of items) {
        const newItem = new Zotero.Item(item.itemType);
        newItem.libraryID = item.libraryID;
        newItem.setCollections(item.getCollections());
        const originalTitle = item.getField('title');

        let fieldsToTranslate = ['title', 'publicationTitle', 'bookTitle', 'conferenceName', 'university', 'publisher', 'place', 'series'];
        if (ENABLE_ABSTRACT_TRANSLATION) {
            fieldsToTranslate.push('abstractNote');
        }
        
        const fieldsToCopy = ['DOI', 'ISSN', 'url', 'volume', 'issue', 'pages', 'date', 'accessDate', 'archiveLocation'];
        
        for (const field of fieldsToTranslate) {
            const originalText = item.getField(field);
            if (originalText) newItem.setField(field, await translateText(originalText));
        }
        
        for (const field of fieldsToCopy) {
             const value = item.getField(field);
             if (value) newItem.setField(field, value);
        }
        
        const originalCreators = item.toJSON().creators || [];
        const newCreators = [];
        for (const creator of originalCreators) {
            let newCreator = { creatorType: creator.creatorType };
            if (creator.name) newCreator.name = await translateText(creator.name);
            else { newCreator.firstName = await translateText(creator.firstName); newCreator.lastName = await translateText(creator.lastName); }
            newCreators.push(newCreator);
        }
        if (newCreators.length > 0) newItem.setCreators(newCreators);

        if (ENABLE_SHORT_TITLE_LINK) {
            newItem.setField('shortTitle', `[原] ${originalTitle}`);
        }

        if (ENABLE_TAGS) {
            newItem.addTag(TAG_FOR_TRANSLATED);
        }
        newItem.setField('language', TARGET_LANG);
        
        const newItemID = await newItem.saveTx();

        if (newItemID) {
            if (ENABLE_RELATION_LINK) {
                const oldItemURI = `http://zotero.org/users/${userID}/items/${item.key}`;
                const newItemURI = `http://zotero.org/users/${userID}/items/${newItem.key}`;
                await newItem.addRelation('dc:relation', oldItemURI);
                await item.addRelation('dc:relation', newItemURI);
                await item.saveTx();
            }
            newItems.push(newItem);
        }
        
        translatedCount++;
    }

    // 获取当前窗口的 Zotero 面板
    const pane = Zotero.getActiveZoteroPane();
    if (pane && newItems.length > 0) {
        // 在当前分类下选中新创建的条目
        const newItemIDs = newItems.map(item => item.id);
        
        // 延迟一小段时间再选中条目，确保界面已更新
        await Zotero.Promise.delay(100);
        pane.selectItems(newItemIDs);
        
        // 强制更新界面
        pane.itemsView?.refresh();
    }

    return `处理完成！成功翻译并创建了 ${translatedCount} 个新条目。`;
}

// --- 运行脚本 ---
main().then(result => {
    Zotero.alert(window, "条目翻译器", result);
}).catch(err => {
    Zotero.alert(window, "条目翻译器 - 发生错误", err.toString());
});