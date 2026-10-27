// Edit the ids and tab names here if the spreadsheet moves.
// Items are read from itemsSheetName. The collection standard is read from criteriaSheetName.
// Search requests are read from requestsSheetName.
// Leave APPS_SCRIPT_URL empty until the web app is deployed; the search form stays disabled.
// Remake file links stay a column on the items tab; this file only lists endpoints.
(function (root) {
  var sheetId = "18GpxBCwT-uvyMX2q3Rr_byo31Lw1fQTdWwDlOBfzHec";
  var itemsSheetName = "items";
  var itemsGid = "715423116";
  var criteriaSheetName = "criteria";
  var criteriaGid = "1210649956";
  var requestsSheetName = "requests";

  root.GALLERY_CONFIG = {
    sheetId: sheetId,
    itemsSheetName: itemsSheetName,
    itemsGid: itemsGid,
    criteriaSheetName: criteriaSheetName,
    criteriaGid: criteriaGid,
    requestsSheetName: requestsSheetName,
    requestsGid: "",
    itemsCsvUrl:
      "https://docs.google.com/spreadsheets/d/" +
      sheetId +
      "/gviz/tq?tqx=out:csv&sheet=" +
      encodeURIComponent(itemsSheetName),
    itemsCsvFallbackUrl:
      "https://docs.google.com/spreadsheets/d/" +
      sheetId +
      "/export?format=csv&gid=" +
      encodeURIComponent(itemsGid),
    sheetEditUrl: "https://docs.google.com/spreadsheets/d/" + sheetId + "/edit",
    criteriaEditUrl:
      "https://docs.google.com/spreadsheets/d/" + sheetId + "/edit#gid=" + criteriaGid,
    driveFolderUrl: "https://drive.google.com/drive/folders/1xdscPdM4jwiArGNkJ2x5oNi5nHjt-e-u",
    APPS_SCRIPT_URL: "",
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
