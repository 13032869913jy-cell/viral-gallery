// Gallery data loading and card rendering. Sheet column names are read by header.
(function (root) {
  "use strict";

  var PRIVATE_MSG = "数据表暂未公开，请在 Google 表格里把共享设为『知道链接的任何人可查看』";
  var FOCUS_SECTION = "当前重点方向";
  var REQ_FIELDS = [
    ["req_owner", "需求人"],
    ["req_app_name", "应用名称"],
    ["req_detail", "需求详情"],
    ["req_type", "需求类型"],
    ["req_ref_url", "参考链接"],
    ["req_ref_effect", "参考效果"],
    ["req_priority", "优先级"],
    ["req_due_date", "期望交付日期"],
  ];
  var FILTERS = {
    f1: [
      ["all", "全部", function () { return true; }],
      ["remade", "已复刻", function (c) { return c.remade; }],
      ["not", "未复刻", function (c) { return !c.remade; }],
      ["tpl", "有模版", function (c) { return c.hasTpl; }],
    ],
    f2: [
      ["all", "全部类型", function () { return true; }],
      ["视频", "视频", function (c) { return c.type === "视频"; }],
      ["图片", "图片", function (c) { return c.type === "图片"; }],
    ],
    f3: [
      ["all", "全部", function () { return true; }],
      ["yes", "适合做模板", function (c) { return c.templateFit === "适合"; }],
      ["maybe", "待定", function (c) { return c.templateFit === "待定"; }],
      ["no", "不适合", function (c) { return c.templateFit === "不适合"; }],
    ],
    f4: [
      ["all", "全部", function () { return true; }],
      ["high", "高", function (c) { return c.reqPriority === "高"; }],
      ["mid", "中", function (c) { return c.reqPriority === "中"; }],
      ["low", "低", function (c) { return c.reqPriority === "低"; }],
    ],
  };

  var state = { f1: "all", f2: "all", f3: "all", f4: "all", sort: "new" };
  var cards = [];
  var criteriaShown = false;
  var io = null;
  var loading = false;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
    });
  }

  function cell(row, key) {
    if (!row || row[key] == null) return "";
    return String(row[key]).trim();
  }

  function safeUrl(url) {
    var s = String(url || "").trim();
    if (!s) return "";
    try {
      var u = new URL(s);
      if (u.protocol === "http:" || u.protocol === "https:") return u.href;
    } catch (e) {}
    return "";
  }

  function parseCSV(text) {
    var src = String(text == null ? "" : text).replace(/^\uFEFF/, "");
    var rows = [];
    var row = [];
    var field = "";
    var i = 0;
    var inQuotes = false;
    while (i < src.length) {
      var c = src.charAt(i);
      if (inQuotes) {
        if (c === '"') {
          if (src.charAt(i + 1) === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i += 1;
          continue;
        }
        if (c === "\r") {
          field += "\n";
          i += src.charAt(i + 1) === "\n" ? 2 : 1;
          continue;
        }
        field += c;
        i += 1;
        continue;
      }
      if (c === '"') {
        inQuotes = true;
        i += 1;
        continue;
      }
      if (c === ",") {
        row.push(field);
        field = "";
        i += 1;
        continue;
      }
      if (c === "\n" || c === "\r") {
        if (c === "\r" && src.charAt(i + 1) === "\n") i += 1;
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
        i += 1;
        continue;
      }
      field += c;
      i += 1;
    }
    if (field.length || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  function rowsToRecords(rows) {
    var headers = (rows[0] || []).map(function (h) {
      return String(h).replace(/^\uFEFF/, "").trim();
    });
    var out = [];
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i] || [];
      var any = false;
      for (var k = 0; k < r.length; k++) {
        if (String(r[k]).trim() !== "") { any = true; break; }
      }
      if (!any) continue;
      var obj = {};
      headers.forEach(function (h, idx) {
        if (!h) return;
        obj[h] = r[idx] == null ? "" : String(r[idx]);
      });
      out.push(obj);
    }
    return out;
  }

  function parseTime(value) {
    if (value == null) return null;
    var s = String(value).trim();
    if (!s) return null;
    s = s.replace(/\s*\(UTC\+8\)\s*$/i, "").trim();
    if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s) || s.indexOf("T") !== -1) {
      var iso = Date.parse(s);
      if (!isNaN(iso)) return iso;
    }
    var m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) {
      var fallback = Date.parse(s);
      return isNaN(fallback) ? null : fallback;
    }
    var y = Number(m[1]);
    var mo = Number(m[2]);
    var d = Number(m[3]);
    var h = m[4] != null ? Number(m[4]) : 0;
    var mi = m[5] != null ? Number(m[5]) : 0;
    var se = m[6] != null ? Number(m[6]) : 0;
    return Date.UTC(y, mo - 1, d, h - 8, mi, se);
  }

  function formatBeijing(ms) {
    var parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(ms));
    function g(type) {
      for (var i = 0; i < parts.length; i++) if (parts[i].type === type) return parts[i].value;
      return "";
    }
    return g("year") + "-" + g("month") + "-" + g("day") + " " + g("hour") + ":" + g("minute");
  }

  function latestStamp(values, fallbackMs) {
    var best = null;
    for (var i = 0; i < values.length; i++) {
      var ms = parseTime(values[i]);
      if (ms == null) continue;
      if (best == null || ms > best) best = ms;
    }
    if (best != null) return formatBeijing(best);
    var raws = [];
    for (var j = 0; j < values.length; j++) {
      var raw = String(values[j] || "").trim();
      if (raw) raws.push(raw);
    }
    raws.sort();
    if (raws.length) return raws[raws.length - 1];
    if (fallbackMs != null) return formatBeijing(fallbackMs);
    return "";
  }

  function parseViews(raw) {
    if (raw == null) return null;
    var s = String(raw).trim();
    if (!s || s === "—" || s === "-") return null;
    var cleaned = s.replace(/[,，\s]/g, "");
    var wan = cleaned.match(/^(-?\d+(?:\.\d+)?)万$/);
    if (wan) return Number(wan[1]) * 10000;
    var yi = cleaned.match(/^(-?\d+(?:\.\d+)?)亿$/);
    if (yi) return Number(yi[1]) * 100000000;
    var n = Number(cleaned);
    return isFinite(n) ? n : null;
  }

  function formatCount(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s) return "";
    if (/^\d+$/.test(s)) return Number(s).toLocaleString("zh-CN");
    return s;
  }

  function normType(value) {
    var s = String(value || "").trim().toLowerCase();
    if (s === "视频" || s === "video") return "视频";
    if (s === "图片" || s === "image" || s === "img" || s === "photo") return "图片";
    return String(value || "").trim();
  }

  function isNew(collectedMs, now) {
    if (collectedMs == null) return false;
    var current = now == null ? Date.now() : now;
    var age = current - collectedMs;
    var hour = 3600 * 1000;
    return age <= 48 * hour && age >= -12 * hour;
  }

  function origMedia(row) {
    var video = safeUrl(cell(row, "original_video_url"));
    var poster = safeUrl(cell(row, "original_poster"));
    var image = safeUrl(cell(row, "original_image_url"));
    if (video) return { type: "video", video_url: video, poster: poster };
    if (image) return { type: "image", image_url: image };
    return null;
  }

  function oursMedia(row) {
    var video = safeUrl(cell(row, "ours_video_url"));
    if (!video) return null;
    return { type: "video", video_url: video, poster: safeUrl(cell(row, "ours_poster")) };
  }

  function mapItems(records) {
    var used = {};
    return records.map(function (row, index) {
      var id = cell(row, "id") || ("row-" + (index + 1));
      if (used[id]) {
        var n = 2;
        while (used[id + "-" + n]) n += 1;
        id = id + "-" + n;
      }
      used[id] = true;
      var req = {};
      REQ_FIELDS.forEach(function (pair) { req[pair[0]] = cell(row, pair[0]); });
      var viewsRaw = cell(row, "original_views");
      var collectedAt = cell(row, "collected_at");
      return {
        id: id,
        title: cell(row, "title"),
        type: normType(cell(row, "type")),
        remade: cell(row, "remade") === "是" || !!cell(row, "ours_url"),
        hasTpl: cell(row, "template_status") === "已上线",
        orig: origMedia(row),
        ours: oursMedia(row),
        origUrl: cell(row, "original_url"),
        oursUrl: cell(row, "ours_url"),
        prompt: cell(row, "prompt_text"),
        promptStatus: cell(row, "prompt_status"),
        model: cell(row, "model"),
        oursModel: cell(row, "ours_model"),
        effect: cell(row, "effect"),
        author: cell(row, "original_author"),
        platform: cell(row, "original_platform"),
        x: cell(row, "x_status"),
        ig: cell(row, "ig_status"),
        tt: cell(row, "tiktok_status"),
        tpl: cell(row, "template_status"),
        seo: cell(row, "seo_status"),
        origMetrics: { views: viewsRaw, likes: cell(row, "original_likes") },
        oursMetrics: { views: cell(row, "ours_views"), likes: cell(row, "ours_likes") },
        viewsNum: parseViews(viewsRaw),
        collectedAt: collectedAt,
        collectedMs: parseTime(collectedAt),
        source: cell(row, "source"),
        templateFit: cell(row, "template_fit"),
        templateReason: cell(row, "template_reason"),
        req: req,
        reqPriority: cell(row, "req_priority"),
        driveOrig: safeUrl(cell(row, "drive_original_url")),
        driveRemake: safeUrl(cell(row, "drive_seaart_url")),
        origVideoUrl: safeUrl(cell(row, "original_video_url")),
        updatedAt: cell(row, "updated_at"),
        sheetIndex: index,
      };
    });
  }

  function viewsRank(n) { return n == null ? -Infinity : n; }

  function byNewest(a, b) {
    var ta = a.collectedMs == null ? -Infinity : a.collectedMs;
    var tb = b.collectedMs == null ? -Infinity : b.collectedMs;
    if (tb !== ta) return tb - ta;
    var vb = viewsRank(b.viewsNum) - viewsRank(a.viewsNum);
    if (vb) return vb;
    return a.sheetIndex - b.sheetIndex;
  }

  function byHot(a, b) {
    var vb = viewsRank(b.viewsNum) - viewsRank(a.viewsNum);
    if (vb) return vb;
    var ta = a.collectedMs == null ? -Infinity : a.collectedMs;
    var tb = b.collectedMs == null ? -Infinity : b.collectedMs;
    if (tb !== ta) return tb - ta;
    return a.sheetIndex - b.sheetIndex;
  }

  function sortItems(list, mode) {
    return list.slice().sort(mode === "hot" ? byHot : byNewest);
  }

  function matchFilters(c, current) {
    var keys = ["f1", "f2", "f3", "f4"];
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var defs = FILTERS[key];
      var found = null;
      for (var j = 0; j < defs.length; j++) if (defs[j][0] === current[key]) found = defs[j];
      if (!found) found = defs[0];
      if (!found[2](c)) return false;
    }
    return true;
  }

  function hasTicket(c) {
    if (!c || !c.req) return false;
    for (var i = 0; i < REQ_FIELDS.length; i++) if (c.req[REQ_FIELDS[i][0]]) return true;
    return false;
  }

  function ticketText(c) {
    return REQ_FIELDS.map(function (pair) {
      return pair[1] + "：" + ((c.req && c.req[pair[0]]) || "—");
    }).join("\n");
  }

  function promptDisabledLabel(status) {
    var s = String(status || "").trim();
    if (!s || s === "—" || s === "作者已公开") return "Prompt 未记录";
    if (s === "作者未公开" || s.indexOf("Prompt") === 0) return s;
    return "Prompt " + s;
  }

  function originalDownloadUrl(c) {
    return (c && (c.driveOrig || c.origVideoUrl)) || "";
  }

  function versionDriveUrl(c, key) {
    if (!c) return "";
    return key === "ours" ? (c.driveRemake || "") : (c.driveOrig || "");
  }

  function linkify(text) {
    var s = String(text == null ? "" : text);
    var re = /https?:\/\/[^\s<>"']+/g;
    var out = "";
    var last = 0;
    var m;
    while ((m = re.exec(s))) {
      out += esc(s.slice(last, m.index));
      var url = m[0];
      var trailing = "";
      var tm = url.match(/[)\].,;:!?，。、】》]+$/);
      if (tm) {
        url = url.slice(0, -tm[0].length);
        trailing = tm[0];
      }
      var safe = safeUrl(url);
      if (safe) {
        out += '<a href="' + esc(safe) + '" target="_blank" rel="noopener noreferrer">' + esc(url) + "</a>";
        out += esc(trailing);
      } else {
        out += esc(m[0]);
      }
      last = m.index + m[0].length;
    }
    out += esc(s.slice(last));
    return out;
  }

  function rich(text) {
    var s = String(text == null ? "" : text).trim();
    if (!s) return "—";
    return linkify(s);
  }

  function metaLine(c, key) {
    var bits = [c.author || "—", c.platform || "—"];
    var model = key === "ours" && c.oursModel ? c.oursModel : c.model;
    if (model) bits.push("模型：" + model);
    return bits.join(" · ");
  }

  function metricsText(c, key) {
    var m = key === "ours" ? c.oursMetrics : c.origMetrics;
    if (!m) return "";
    var parts = [];
    if (m.views) parts.push("播放 " + formatCount(m.views));
    if (m.likes) parts.push("赞 " + formatCount(m.likes));
    return parts.join(" · ");
  }

  function chipCls(v) {
    var s = String(v || "");
    if (/已发|已上线/.test(s)) return "ok";
    if (/排期|已提需求|候选|暂缓|缺/.test(s)) return "warn";
    if (/排除/.test(s)) return "bad";
    return "";
  }

  function fitChip(c) {
    if (!c.templateFit) return "";
    var cls = c.templateFit === "适合" ? "ok" : c.templateFit === "待定" ? "warn" : c.templateFit === "不适合" ? "bad" : "";
    var title = c.templateReason ? ' title="' + esc(c.templateReason) + '"' : "";
    return '<span class="chip ' + cls + '"' + title + ">可做模板：" + esc(c.templateFit) + "</span>";
  }

  function priorityChip(c) {
    var v = c.reqPriority;
    if (!v) return "";
    var cls = v === "高" ? "bad" : v === "中" ? "warn" : v === "低" ? "ok" : "";
    return '<span class="chip ' + cls + '" title="优先级：' + esc(v) + '">优先级：' + esc(v) + "</span>";
  }

  function statusChips(c) {
    return [["X", c.x], ["IG", c.ig], ["TikTok", c.tt], ["站内模版", c.tpl], ["SEO", c.seo]].map(function (pair) {
      return '<span class="chip ' + chipCls(pair[1]) + '">' + pair[0] + " " + esc(pair[1] || "—") + "</span>";
    }).join("");
  }

  function mediaHTML(m) {
    if (!m) return '<div class="ph">暂无素材</div>';
    if (m.type === "image") {
      return '<img src="' + esc(m.image_url) + '" alt="" loading="lazy" referrerpolicy="no-referrer">';
    }
    var poster = m.poster ? ' poster="' + esc(m.poster) + '"' : "";
    return '<video muted loop playsinline webkit-playsinline preload="none" referrerpolicy="no-referrer"' + poster + ' src="' + esc(m.video_url) + '"></video>';
  }

  function extLink(url, label) {
    var safe = safeUrl(url);
    if (!safe) return "";
    return '<a href="' + esc(safe) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + "</a>";
  }

  function ticketHtml(c) {
    if (!hasTicket(c)) return "";
    var rows = REQ_FIELDS.map(function (pair) {
      return "<dt>" + esc(pair[1]) + "</dt><dd>" + rich(c.req[pair[0]]) + "</dd>";
    }).join("");
    return '<details class="ticket"><summary>模板需求单</summary><dl class="kvs">' + rows + '</dl><button type="button" data-copy-req="' + esc(c.id) + '">复制需求单</button></details>';
  }

  function cardHtml(c, now) {
    var key = c.orig ? "orig" : "ours";
    var sw = "";
    if (c.orig && c.ours) {
      sw = '<div class="sw"><button type="button" class="on" data-k="orig">原版</button><button type="button" data-k="ours">复刻</button></div>';
    } else if (!c.orig && c.ours) {
      sw = '<div class="sw"><button type="button" class="on" data-k="ours">复刻</button></div>';
    }
    var badges = (c.hasTpl ? "" : '<span class="badge">模版待上线</span>') + (isNew(c.collectedMs, now) ? '<span class="badge new">NEW</span>' : "");
    var promptBtn = c.prompt
      ? '<button type="button" data-copy="' + esc(c.id) + '">复制 Prompt</button>'
      : '<button type="button" disabled>' + esc(promptDisabledLabel(c.promptStatus)) + "</button>";
    var primary = originalDownloadUrl(c);
    var ver = versionDriveUrl(c, key);
    var dlBtn = primary
      ? '<a class="dl" href="' + esc(primary) + '" target="_blank" rel="noopener noreferrer">下载原视频</a>'
      : "";
    var dlVer = '<a data-dl target="_blank" rel="noopener noreferrer"' + (ver && ver !== primary ? ' href="' + esc(ver) + '"' : " hidden") + ">下载视频</a>";
    var reason = c.templateReason ? '<div class="reason" title="' + esc(c.templateReason) + '">' + esc(c.templateReason) + "</div>" : "";
    return '<article class="card ' + (c.remade ? "remade" : "") + (c.hasTpl ? "" : " notpl") + '" data-id="' + esc(c.id) + '">' +
      '<div class="cover">' + mediaHTML(c.orig || c.ours) +
        '<div class="badges">' + badges + "</div>" +
        '<span class="tag ' + (c.remade ? "g" : "r") + '">' + (c.remade ? "已复刻" : "未复刻") + "</span>" + sw +
      "</div>" +
      '<div class="body">' +
        '<div class="t">' + esc(c.title || "未命名") + "</div>" +
        '<div class="meta who">' + esc(metaLine(c, key)) + "</div>" +
        '<div class="meta stats">' + esc(metricsText(c, key)) + "</div>" +
        '<div class="fx">' + esc(c.effect) + "</div>" +
        '<div class="chips">' + fitChip(c) + priorityChip(c) + statusChips(c) + "</div>" +
        reason +
        ticketHtml(c) +
        '<div class="acts">' + dlBtn + dlVer + extLink(c.origUrl, "原帖") + extLink(c.oursUrl, "我们的复刻") + promptBtn + "</div>" +
      "</div></article>";
  }

  function mapCriteria(records) {
    var rows = [];
    records.forEach(function (row, index) {
      var section = cell(row, "section");
      var item = cell(row, "item");
      var value = cell(row, "value");
      var updatedAt = cell(row, "updated_at");
      if (!section && !item && !value) return;
      rows.push({
        section: section || "未分组",
        item: item,
        value: value,
        updatedAt: updatedAt,
        index: index,
      });
    });
    return rows;
  }

  function groupCriteria(rows) {
    var groups = [];
    var seen = {};
    rows.forEach(function (r) {
      var g = seen[r.section];
      if (!g) {
        g = { section: r.section, focus: r.section === FOCUS_SECTION, rows: [] };
        seen[r.section] = g;
        groups.push(g);
      }
      g.rows.push(r);
    });
    return groups;
  }

  function criteriaHtml(groups) {
    return groups.map(function (g) {
      var body = g.rows.map(function (r) {
        var value = r.value ? linkify(r.value) : "—";
        if (!r.item) return '<div class="crow one"><div class="cv">' + value + "</div></div>";
        return '<div class="crow"><div class="ci">' + esc(r.item) + '</div><div class="cv">' + value + "</div></div>";
      }).join("");
      return '<section class="cgroup' + (g.focus ? " focus" : "") + '"><h3>' + esc(g.section) + "</h3>" + body + "</section>";
    }).join("");
  }

  function criteriaStamp(rows) {
    return latestStamp(rows.map(function (r) { return r.updatedAt; }), null);
  }

  function criteriaUrls(cfg) {
    var urls = [];
    if (!cfg) return urls;
    if (cfg.criteriaCsvUrl) urls.push(cfg.criteriaCsvUrl);
    if (cfg.sheetId && cfg.criteriaSheetName) {
      var built = "https://docs.google.com/spreadsheets/d/" + cfg.sheetId + "/gviz/tq?tqx=out:csv&sheet=" + encodeURIComponent(cfg.criteriaSheetName);
      if (urls.indexOf(built) === -1) urls.push(built);
    }
    if (cfg.sheetId && cfg.criteriaGid) {
      urls.push("https://docs.google.com/spreadsheets/d/" + cfg.sheetId + "/export?format=csv&gid=" + encodeURIComponent(String(cfg.criteriaGid)));
    }
    return urls;
  }

  function withCacheBust(url) {
    var u = new URL(url);
    u.searchParams.set("_", String(Date.now()));
    return u.toString();
  }

  function isPrivateBody(text) {
    var t = String(text || "").trim().slice(0, 500).toLowerCase();
    if (!t) return false;
    if (t.indexOf("<!doctype") === 0 || t.indexOf("<html") === 0 || t.indexOf("<head") === 0) return true;
    if (t.indexOf("accounts.google.com") !== -1) return true;
    return false;
  }

  function fetchCsv(urls, headerOk) {
    if (!urls || !urls.length) return Promise.reject(new Error(PRIVATE_MSG));
    var sawPrivate = false;
    var sawBadHeader = false;
    var lastStatus = 0;
    var networkFail = 0;

    function next(index) {
      if (index >= urls.length) {
        if (sawPrivate || (networkFail && !lastStatus && !sawBadHeader)) return Promise.reject(new Error(PRIVATE_MSG));
        if (sawBadHeader && !lastStatus) return Promise.reject(new Error("没有读到表头，请确认工作表第一行是字段名。"));
        if (lastStatus) return Promise.reject(new Error("数据加载失败（HTTP " + lastStatus + "），请点「刷新」重试。"));
        return Promise.reject(new Error("数据加载失败，请点「刷新」重试。"));
      }
      var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 20000);
      return fetch(withCacheBust(urls[index]), {
        cache: "no-store",
        redirect: "follow",
        referrerPolicy: "no-referrer",
        signal: ctrl ? ctrl.signal : undefined,
      }).then(function (res) {
        return res.text().then(function (text) { return { res: res, text: text }; });
      }).then(function (got) {
        clearTimeout(timer);
        var res = got.res;
        var text = got.text;
        if (res.status === 401 || res.status === 403 || isPrivateBody(text)) {
          sawPrivate = true;
          return next(index + 1);
        }
        if (!res.ok) {
          lastStatus = res.status;
          return next(index + 1);
        }
        var rows = parseCSV(text);
        var headers = (rows[0] || []).map(function (h) { return String(h).replace(/^\uFEFF/, "").trim(); });
        if (!headerOk(headers)) {
          if (isPrivateBody(text)) sawPrivate = true;
          else sawBadHeader = true;
          return next(index + 1);
        }
        return { text: text, rows: rows, headers: headers };
      }).catch(function (e) {
        clearTimeout(timer);
        if (e && e.name === "AbortError") return Promise.reject(new Error("数据加载超时，请点「刷新」重试。"));
        if (e && e.message && (e.message === PRIVATE_MSG || e.message.indexOf("数据加载") === 0 || e.message.indexOf("没有读到表头") === 0)) {
          return Promise.reject(e);
        }
        networkFail += 1;
        return next(index + 1);
      });
    }
    return next(0);
  }

  function videoIO() {
    if (io) return io;
    if (typeof IntersectionObserver === "undefined") return null;
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        var v = en.target;
        if (en.isIntersecting) {
          v.dataset.inView = "1";
          var p = v.play();
          if (p && p.catch) p.catch(function () {});
        } else {
          v.dataset.inView = "0";
          v.pause();
        }
      });
    }, { threshold: 0.55 });
    return io;
  }

  function observeVideos(scope) {
    var obs = videoIO();
    if (!scope) return;
    scope.querySelectorAll("video").forEach(function (v) {
      v.muted = true;
      v.defaultMuted = true;
      v.loop = true;
      v.playsInline = true;
      if (obs) obs.observe(v);
    });
  }

  function stopVideos(scope) {
    if (!scope) return;
    scope.querySelectorAll("video").forEach(function (v) {
      if (io) io.unobserve(v);
      v.pause();
      v.removeAttribute("src");
      try { v.load(); } catch (e) {}
    });
  }

  function toast(message) {
    if (typeof document === "undefined") return;
    var t = document.getElementById("toast");
    if (!t) return;
    t.textContent = message;
    t.classList.add("on");
    setTimeout(function () { t.classList.remove("on"); }, 1600);
  }

  function copyText(text, okMsg) {
    function done() { toast(okMsg); }
    function fallback() {
      var area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      try { document.execCommand("copy"); } catch (e) {}
      area.remove();
      done();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(fallback);
    } else {
      fallback();
    }
  }

  function fillSeg(el, defs, key) {
    if (!el) return;
    el.innerHTML = defs.map(function (def) {
      var on = state[key] === def[0] ? "on" : "";
      return '<button type="button" data-v="' + esc(def[0]) + '" class="' + on + '">' + esc(def[1]) + '<span class="n">' + cards.filter(def[2]).length + "</span></button>";
    }).join("");
  }

  function render() {
    fillSeg(document.getElementById("f1"), FILTERS.f1, "f1");
    fillSeg(document.getElementById("f2"), FILTERS.f2, "f2");
    fillSeg(document.getElementById("f3"), FILTERS.f3, "f3");
    fillSeg(document.getElementById("f4"), FILTERS.f4, "f4");
    var sortEl = document.getElementById("sort");
    if (sortEl) {
      sortEl.innerHTML = [["new", "最新"], ["hot", "最热"]].map(function (pair) {
        return '<button type="button" data-v="' + pair[0] + '" class="' + (state.sort === pair[0] ? "on" : "") + '">' + pair[1] + "</button>";
      }).join("");
    }
    var list = sortItems(cards.filter(function (c) { return matchFilters(c, state); }), state.sort);
    var grid = document.getElementById("grid");
    stopVideos(grid);
    var now = Date.now();
    grid.innerHTML = list.length
      ? list.map(function (c) { return cardHtml(c, now); }).join("")
      : '<div class="state">当前筛选下没有条目。</div>';
    observeVideos(grid);
  }

  function showState(kind, text) {
    var grid = document.getElementById("grid");
    if (!grid) return;
    stopVideos(grid);
    grid.innerHTML = '<div class="state' + (kind ? " " + kind : "") + '">' + esc(text) + "</div>";
  }

  function setAsof(text) {
    var el = document.getElementById("asof");
    if (el) el.textContent = text;
  }

  function showCriteria(rows) {
    var el = document.getElementById("criteria");
    if (!el) return;
    var body = document.getElementById("criteria-body");
    var asof = document.getElementById("criteria-asof");
    if (body) body.innerHTML = criteriaHtml(groupCriteria(rows));
    var stamp = criteriaStamp(rows);
    if (asof) asof.textContent = stamp ? ("标准更新于 " + stamp) : "";
    el.hidden = false;
    if (!criteriaShown) {
      el.open = window.matchMedia("(min-width: 760px)").matches;
      criteriaShown = true;
    }
  }

  function hideCriteria() {
    var el = document.getElementById("criteria");
    if (!el) return;
    el.hidden = true;
    el.open = false;
    criteriaShown = false;
    var body = document.getElementById("criteria-body");
    if (body) body.innerHTML = "";
    var asof = document.getElementById("criteria-asof");
    if (asof) asof.textContent = "";
  }

  function refreshCriteria(cfg) {
    return fetchCsv(criteriaUrls(cfg), function (headers) {
      return headers.indexOf("section") !== -1 || headers.indexOf("item") !== -1 || headers.indexOf("value") !== -1;
    }).then(function (got) {
      var rows = mapCriteria(rowsToRecords(got.rows));
      if (!rows.length) {
        hideCriteria();
        return;
      }
      showCriteria(rows);
    }).catch(function () {
      if (!criteriaShown) hideCriteria();
    });
  }

  function applyVersion(art, c, key) {
    var cov = art.querySelector(".cover");
    var old = cov.querySelector("video, img, .ph");
    if (old && old.tagName === "VIDEO") {
      if (io) io.unobserve(old);
      old.pause();
    }
    var tmp = document.createElement("div");
    tmp.innerHTML = mediaHTML(c[key]);
    var next = tmp.firstElementChild;
    if (old && next) old.replaceWith(next);
    if (next && next.tagName === "VIDEO") observeVideos(cov);
    var who = art.querySelector(".who");
    if (who) who.textContent = metaLine(c, key);
    var stats = art.querySelector(".stats");
    if (stats) stats.textContent = metricsText(c, key);
    var dl = art.querySelector("[data-dl]");
    if (dl) {
      var href = versionDriveUrl(c, key);
      var primary = originalDownloadUrl(c);
      if (href) dl.href = href;
      dl.hidden = !(href && href !== primary);
    }
  }

  function bindOnce() {
    ["f1", "f2", "f3", "f4"].forEach(function (key) {
      var el = document.getElementById(key);
      if (!el) return;
      el.addEventListener("click", function (e) {
        var b = e.target.closest("button");
        if (!b) return;
        state[key] = b.dataset.v;
        render();
      });
    });
    var sortEl = document.getElementById("sort");
    if (sortEl) {
      sortEl.addEventListener("click", function (e) {
        var b = e.target.closest("button");
        if (!b) return;
        state.sort = b.dataset.v;
        render();
      });
    }
    var grid = document.getElementById("grid");
    grid.addEventListener("click", function (e) {
      var s = e.target.closest(".sw button");
      if (s) {
        var art = s.closest(".card");
        var c = null;
        for (var i = 0; i < cards.length; i++) if (cards[i].id === art.dataset.id) c = cards[i];
        if (!c) return;
        s.parentNode.querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b === s); });
        applyVersion(art, c, s.dataset.k);
        return;
      }
      var rq = e.target.closest("[data-copy-req]");
      if (rq) {
        var ticket = null;
        for (var t = 0; t < cards.length; t++) if (cards[t].id === rq.dataset.copyReq) ticket = cards[t];
        if (ticket) copyText(ticketText(ticket), "需求单已复制");
        return;
      }
      var cp = e.target.closest("[data-copy]");
      if (cp) {
        var item = null;
        for (var p = 0; p < cards.length; p++) if (cards[p].id === cp.dataset.copy) item = cards[p];
        if (item) copyText(item.prompt, "Prompt 已复制");
      }
    });
    document.addEventListener("visibilitychange", function () {
      document.querySelectorAll("video").forEach(function (v) {
        if (document.hidden) v.pause();
        else if (v.dataset.inView === "1") {
          var play = v.play();
          if (play && play.catch) play.catch(function () {});
        }
      });
    });
  }

  function load(cfg) {
    if (loading) return;
    loading = true;
    var btn = document.getElementById("refresh");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "刷新中…";
    }
    var first = cards.length === 0;
    if (first) showState("", "正在加载数据…");
    else setAsof("正在刷新…");
    var criteriaTask = refreshCriteria(cfg);
    var itemsUrls = [cfg.itemsCsvUrl, cfg.itemsCsvFallbackUrl].filter(Boolean);
    return fetchCsv(itemsUrls, function (headers) {
      return headers.indexOf("id") !== -1 || headers.indexOf("title") !== -1;
    }).then(function (got) {
      var fetchedAt = Date.now();
      cards = mapItems(rowsToRecords(got.rows));
      var stamp = latestStamp(cards.map(function (c) { return c.updatedAt; }), fetchedAt);
      setAsof("数据更新于 " + (stamp || "—"));
      render();
    }).catch(function (err) {
      var message = (err && err.message) || "数据加载失败，请点「刷新」重试。";
      if (first) {
        setAsof("数据更新于 —");
        showState("err", message);
      } else {
        toast(message);
      }
    }).then(function () {
      loading = false;
      if (btn) {
        btn.disabled = false;
        btn.textContent = "刷新";
      }
      return criteriaTask;
    });
  }

  function mount(doc) {
    if (!doc || !doc.getElementById || !doc.getElementById("grid")) return;
    var cfg = root.GALLERY_CONFIG;
    var edit = doc.getElementById("edit-link");
    var dl = doc.getElementById("dl-all");
    if (!cfg || !cfg.itemsCsvUrl) {
      showState("err", "缺少配置文件 config.js。");
      return;
    }
    if (edit && cfg.sheetEditUrl) edit.href = cfg.sheetEditUrl;
    if (dl && cfg.driveFolderUrl) dl.href = cfg.driveFolderUrl;
    bindOnce();
    var refresh = doc.getElementById("refresh");
    if (refresh) refresh.addEventListener("click", function () { load(cfg); });
    load(cfg);
  }

  var api = {
    parseCSV: parseCSV,
    rowsToRecords: rowsToRecords,
    mapItems: mapItems,
    sortItems: sortItems,
    matchFilters: matchFilters,
    isNew: isNew,
    parseTime: parseTime,
    parseViews: parseViews,
    formatBeijing: formatBeijing,
    latestStamp: latestStamp,
    mapCriteria: mapCriteria,
    groupCriteria: groupCriteria,
    criteriaHtml: criteriaHtml,
    criteriaStamp: criteriaStamp,
    criteriaUrls: criteriaUrls,
    hasTicket: hasTicket,
    ticketText: ticketText,
    cardHtml: cardHtml,
    promptDisabledLabel: promptDisabledLabel,
    originalDownloadUrl: originalDownloadUrl,
    fetchCsv: fetchCsv,
    FILTERS: FILTERS,
    PRIVATE_MSG: PRIVATE_MSG,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.GalleryApp = api;

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { mount(document); });
    else mount(document);
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
