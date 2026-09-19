/**
 * 進入點：試算表選單、Web App、以及 HTML 組裝。
 */

var WR_APP_TITLE = 'War Robots 禮包比價';

function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu(WR_APP_TITLE)
      .addItem('開啟比價面板', 'wrShowPanel')
      .addSeparator()
      .addItem('初始化 / 修復工作表', 'wrSetup')
      .addItem('載入範例資料', 'wrLoadSampleData')
      .addToUi();
  } catch (e) {
    // 非試算表環境（例如直接在編輯器裡執行）沒有 UI，忽略即可。
  }
}

/** Web App 進入點：手機或電腦開這個網址就能用。 */
function doGet() {
  return renderApp_()
    .setTitle(WR_APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** 在試算表內以對話框開啟同一份介面。 */
function wrShowPanel() {
  var ui = SpreadsheetApp.getUi();
  var html = renderApp_().setWidth(1280).setHeight(860);
  ui.showModalDialog(html, WR_APP_TITLE);
}

function renderApp_() {
  return HtmlService.createTemplateFromFile('ui/Index').evaluate();
}

/** 給 HTML 模板用的引入語法：<?!= include('ui/styles') ?> */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

function wrSetup() {
  var result = wrEnsureSchema();
  try {
    SpreadsheetApp.getUi().alert('工作表已就緒', '已建立／補齊所有欄位，可以開始新增禮包了。', SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    // 無 UI 環境
  }
  return result;
}

/** 載入一組示範禮包（見 lib/sample.js）。試用完直接刪掉那些列即可。 */
function wrLoadSampleData() {
  wrEnsureSchema();
  var samples = WR_SAMPLE.bundles();
  for (var i = 0; i < samples.length; i++) wrSaveBundle(samples[i]);
  return samples.length;
}
