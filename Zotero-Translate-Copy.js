/*
 * ZOTERO 条目翻译器 - 最终发布版 v1.0
 *
 * 这是我们合作调试的最终脚本，功能完善且高度可配置，已准备好分享和使用。
 * 它能够一键翻译Zotero中的中文条目，并自动创建一个包含英文元数据的新条目副本。
 *
 * 感谢我们这段精彩的合作之旅！
 */

// ===================================================================
//                        --- 用户配置区 ---
//      将下面的值设置为 `true` (开启) 或 `false` (关闭) 来控制相应功能
// ===================================================================

// 启用“关联”功能：在原始条目和翻译后的条目之间，创建一个可互相点击的“关联”链接。
const ENABLE_RELATION_LINK = true;

// 启用“短标题回链”：将原始的中文标题，添加到新条目的“短标题”字段中，方便快速识别和对照。
const ENABLE_SHORT_TITLE_LINK = true;

// 启用“摘要”翻译：翻译原文的摘要部分。由于摘要通常很长，关闭此项可以显著加快脚本运行速度。
const ENABLE_ABSTRACT_TRANSLATION = true;

// ===================================================================
//                      --- 配置区结束 ---
//                (通常无需修改此行下方的代码)
// ===================================================================


// --- 核心脚本逻辑 ---

const SOURCE_LANG = 'zh-CN';
const TARGET_LANG = 'en';
const TAG_FOR_TRANSLATED = 'Translated_Copy';
const MAX_RETRIES = 3;

async function translateText(text) {
    if (!text || typeof text !== 'string' || !text.trim()) return text;
    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${SOURCE_LANG}&tl=${TARGET_LANG}&dt=t&q=${encodeURIComponent(text)}`;
            const res = await Zotero.HTTP.request('GET', url);
            if (res.status === 200 && res.responseText) {
                const json = JSON.parse(res.responseText);
                if (json && json[0]) return json[0].map(segment => segment[0]).join('');
            }
        } catch (e) { Zotero.debug(`翻译尝试 ${i + 1} 次失败: ${e}`); }
        if (i < MAX_RETRIES - 1) await Zotero.Promise.delay(300 * (i + 1));
    }
    return `[翻译失败] ${text}`;
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

        newItem.addTag(TAG_FOR_TRANSLATED);
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

    const pane = Zotero.getActiveZoteroPane();
    if (pane && newItems.length > 0) {
        const newItemIDs = newItems.map(item => item.id);
        pane.selectItems(newItemIDs, true);
    }

    return `处理完成！成功翻译并创建了 ${translatedCount} 个新条目。`;
}

// --- 运行脚本 ---
main().then(result => {
    Zotero.alert(window, "条目翻译器", result);
}).catch(err => {
    Zotero.alert(window, "条目翻译器 - 发生错误", err.toString());
});