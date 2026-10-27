/**
 * Web app bound to the collection spreadsheet.
 * Script properties (Project settings → Script properties):
 *   PASSCODE            one or more passcodes, separated by commas
 *   WEBHOOK_URL         where a new request is announced
 *   WEBHOOK_KEY         secret sent to that service
 *   WEBHOOK_KEY_HEADER  optional, default Authorization
 *   WEBHOOK_KEY_PREFIX  optional, default "Bearer " (set empty for no prefix)
 *   DAILY_LIMIT         optional, default 10
 * Do not log the passcode or the webhook key.
 */
var SHEET_ID = "18GpxBCwT-uvyMX2q3Rr_byo31Lw1fQTdWwDlOBfzHec";
var REQUESTS_TAB = "requests";
var REQUEST_HEADERS = [
  "request_id",
  "keyword",
  "note",
  "status",
  "created_at",
  "started_at",
  "finished_at",
  "added_count",
  "added_ids",
  "result_note",
];
var TZ = "Asia/Shanghai";

function setup() {
  var ss = spreadsheet_();
  var sheet = ss.getSheetByName(REQUESTS_TAB);
  if (!sheet) sheet = ss.insertSheet(REQUESTS_TAB);
  ensureHeaders_(sheet);
  sheet.setFrozenRows(1);
}

function doGet() {
  return json_({ ok: true, message: "搜索服务在线" });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(15000);
  } catch (err) {
    return json_({ ok: false, message: "系统繁忙，请稍后再试" });
  }
  try {
    return handlePost_(e);
  } catch (err) {
    return json_({ ok: false, message: "提交失败" });
  } finally {
    lock.releaseLock();
  }
}

function handlePost_(e) {
  var body;
  try {
    var raw = e && e.postData && e.postData.contents ? String(e.postData.contents) : "";
    body = JSON.parse(raw);
  } catch (err) {
    return json_({ ok: false, message: "请求格式不正确" });
  }
  if (!body || typeof body !== "object") return json_({ ok: false, message: "请求格式不正确" });

  var props = PropertiesService.getScriptProperties();
  var passcode = String(body.passcode == null ? "" : body.passcode).trim();
  if (!passcodeAllowed_(props, passcode)) return json_({ ok: false, message: "口令错误" });

  var keyword = String(body.keyword == null ? "" : body.keyword).trim();
  if (!keyword) return json_({ ok: false, message: "请填写关键词" });
  if (keyword.length > 60) return json_({ ok: false, message: "关键词不能超过 60 个字" });
  var note = String(body.note == null ? "" : body.note).trim();

  var sheet = ensureRequests_(spreadsheet_());
  var map = headerMap_(sheet);
  var rows = sheet.getDataRange().getValues();
  var today = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd");
  var limit = dailyLimit_(props);
  var todayCount = 0;
  var duplicate = false;
  for (var i = 1; i < rows.length; i++) {
    var rowKeyword = cellAt_(rows[i], map, "keyword");
    var rowStatus = cellAt_(rows[i], map, "status");
    if (dayKey_(cellRaw_(rows[i], map, "created_at")) === today) todayCount++;
    if (rowKeyword === keyword && (rowStatus === "排队中" || rowStatus === "搜索中")) duplicate = true;
  }
  if (todayCount >= limit) return json_({ ok: false, message: "今日次数已满" });
  if (duplicate) return json_({ ok: false, message: "该关键词已在队列中" });

  var requestId = makeRequestId_();
  var createdAt = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd HH:mm:ss");
  appendFields_(sheet, map, {
    request_id: requestId,
    keyword: keyword,
    note: note,
    status: "排队中",
    created_at: createdAt,
  });

  var notified = notifyWebhook_(props, {
    request_id: requestId,
    keyword: keyword,
    note: note,
  });
  if (!notified.ok) {
    writeFields_(sheet, requestId, {
      status: "失败",
      finished_at: Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd HH:mm:ss"),
      result_note: notified.note,
    });
    return json_({ ok: false, message: "提交失败", request_id: requestId });
  }
  return json_({ ok: true, message: "成功", request_id: requestId });
}

function passcodeAllowed_(props, passcode) {
  if (!passcode) return false;
  var raw = String(props.getProperty("PASSCODE") || "");
  var parts = raw.split(",");
  for (var i = 0; i < parts.length; i++) {
    if (parts[i].trim() && parts[i].trim() === passcode) return true;
  }
  return false;
}

function dailyLimit_(props) {
  var n = parseInt(props.getProperty("DAILY_LIMIT"), 10);
  if (!n || n < 1) return 10;
  return n;
}

function notifyWebhook_(props, payload) {
  var url = String(props.getProperty("WEBHOOK_URL") || "").trim();
  if (!url) return { ok: false, note: "未配置通知地址" };
  var key = props.getProperty("WEBHOOK_KEY");
  var headerName = String(props.getProperty("WEBHOOK_KEY_HEADER") || "").trim() || "Authorization";
  var prefixProp = props.getProperty("WEBHOOK_KEY_PREFIX");
  var prefix = prefixProp === null ? "Bearer " : prefixProp;
  var headers = { "Content-Type": "application/json" };
  if (key) headers[headerName] = prefix + key;
  try {
    var resp = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      headers: headers,
      muteHttpExceptions: true,
    });
    var code = resp.getResponseCode();
    if (code >= 200 && code < 300) return { ok: true, note: "" };
    return { ok: false, note: "通知失败 HTTP " + code };
  } catch (err) {
    return { ok: false, note: "通知失败" };
  }
}

function spreadsheet_() {
  return SpreadsheetApp.openById(SHEET_ID);
}

function ensureRequests_(ss) {
  var sheet = ss.getSheetByName(REQUESTS_TAB);
  if (!sheet) sheet = ss.insertSheet(REQUESTS_TAB);
  ensureHeaders_(sheet);
  return sheet;
}

function ensureHeaders_(sheet) {
  var width = Math.max(sheet.getLastColumn(), REQUEST_HEADERS.length);
  var first = sheet.getRange(1, 1, 1, width).getValues()[0];
  var same = true;
  for (var i = 0; i < REQUEST_HEADERS.length; i++) {
    if (String(first[i] || "").trim() !== REQUEST_HEADERS[i]) same = false;
  }
  if (same) return;
  var empty = sheet.getLastRow() === 0 || String(first[0] || "").trim() === "";
  if (!empty) sheet.insertRowBefore(1);
  sheet.getRange(1, 1, 1, REQUEST_HEADERS.length).setValues([REQUEST_HEADERS]);
}

function headerMap_(sheet) {
  var last = Math.max(sheet.getLastColumn(), REQUEST_HEADERS.length);
  var headers = sheet.getRange(1, 1, 1, last).getValues()[0];
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    var name = String(headers[i] || "").trim();
    if (name) map[name] = i;
  }
  return map;
}

function cellRaw_(row, map, name) {
  if (map[name] == null) return "";
  return row[map[name]];
}

function cellAt_(row, map, name) {
  return String(cellRaw_(row, map, name) == null ? "" : cellRaw_(row, map, name)).trim();
}

function dayKey_(value) {
  if (Object.prototype.toString.call(value) === "[object Date]" && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, TZ, "yyyy-MM-dd");
  }
  var s = String(value || "").trim();
  var m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!m) return "";
  var month = ("0" + m[2]).slice(-2);
  var day = ("0" + m[3]).slice(-2);
  return m[1] + "-" + month + "-" + day;
}

function appendFields_(sheet, map, fields) {
  var width = Math.max(sheet.getLastColumn(), REQUEST_HEADERS.length);
  var row = [];
  for (var i = 0; i < width; i++) row.push("");
  for (var key in fields) {
    if (!Object.prototype.hasOwnProperty.call(fields, key)) continue;
    if (map[key] == null) continue;
    row[map[key]] = fields[key];
  }
  sheet.appendRow(row);
}

function writeFields_(sheet, requestId, fields) {
  var map = headerMap_(sheet);
  if (map.request_id == null) return;
  var values = sheet.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][map.request_id]) !== requestId) continue;
    for (var key in fields) {
      if (!Object.prototype.hasOwnProperty.call(fields, key)) continue;
      if (map[key] == null) continue;
      sheet.getRange(i + 1, map[key] + 1).setValue(fields[key]);
    }
    return;
  }
}

function makeRequestId_() {
  var stamp = Utilities.formatDate(new Date(), TZ, "yyyyMMdd-HHmmss");
  var rand = Utilities.getUuid().replace(/-/g, "").slice(0, 4);
  return "r-" + stamp + "-" + rand;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
