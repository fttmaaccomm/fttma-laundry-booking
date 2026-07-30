// The active spreadsheet
var ss = SpreadsheetApp.getActiveSpreadsheet();
var bookingsSheet = null;
var timeSlotsSheet = null;

function getBookingSheetHeaders() {
  return ['done', 'gender', 'name', 'room_no', 'time_rented_dryer', 'time_rented_washer', 'rented', 'payment_mode', 'paid_to', 'timestamp', 'transaction_no'];
}

function normalizeBookingHeaderName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function reorderBookingSheetColumns(sheet) {
  var desiredHeaders = getBookingSheetHeaders();
  var existingHeaderRow = sheet.getRange(1, 1, 1, Math.max(desiredHeaders.length, sheet.getLastColumn())).getValues()[0];
  var existingHeaders = existingHeaderRow.map(function(value) {
    return String(value || '').trim();
  });
  var existingNormalizedHeaders = existingHeaders.map(normalizeBookingHeaderName);
  var headerIndexByName = {};

  existingNormalizedHeaders.forEach(function(headerName, index) {
    if (!headerIndexByName[headerName]) {
      headerIndexByName[headerName] = index;
    }
  });

  var rows = sheet.getDataRange().getValues();
  var dataRows = rows.length > 1 ? rows.slice(1) : [];
  var reorderedRows = dataRows.map(function(row) {
    return desiredHeaders.map(function(headerName) {
      var normalizedHeader = normalizeBookingHeaderName(headerName);
      var sourceIndex = headerIndexByName[normalizedHeader];
      if (sourceIndex === undefined || sourceIndex === null || sourceIndex >= row.length) {
        return '';
      }
      return row[sourceIndex];
    });
  });

  sheet.clearContents();
  sheet.getRange(1, 1, 1, desiredHeaders.length).setValues([desiredHeaders]);
  if (reorderedRows.length) {
    sheet.getRange(2, 1, reorderedRows.length, desiredHeaders.length).setValues(reorderedRows);
  }
}

function getOrCreateBookingsSheet() {
  if (bookingsSheet && bookingsSheet.getSheetName()) {
    return bookingsSheet;
  }

  bookingsSheet = ss.getSheetByName('Bookings');
  if (!bookingsSheet) {
    bookingsSheet = ss.insertSheet('Bookings');
  }

  var bookingHeaders = getBookingSheetHeaders();
  var existingHeaderRow = bookingsSheet.getRange(1, 1, 1, Math.max(bookingHeaders.length, bookingsSheet.getLastColumn())).getValues()[0];
  var existingNormalizedHeaders = existingHeaderRow.map(normalizeBookingHeaderName);
  var needsBookingHeader = existingNormalizedHeaders.length !== bookingHeaders.length || existingNormalizedHeaders.some(function(value, index) {
    return value !== normalizeBookingHeaderName(bookingHeaders[index]);
  });

  if (needsBookingHeader) {
    reorderBookingSheetColumns(bookingsSheet);
  }

  return bookingsSheet;
}

function getOrCreateTimeSlotsSheet() {
  if (timeSlotsSheet && timeSlotsSheet.getSheetName()) {
    return timeSlotsSheet;
  }

  timeSlotsSheet = ss.getSheetByName('TimeSlots');
  if (!timeSlotsSheet) {
    timeSlotsSheet = ss.insertSheet('TimeSlots');
  }

  var timeSlotHeaders = ['id', 'slot_date', 'slot_time', 'status', 'slot_weekend_type', 'slot_visible_days'];
  var existingTimeSlotHeaders = timeSlotsSheet.getRange(1, 1, 1, timeSlotHeaders.length).getValues()[0];
  var needsTimeSlotHeader = existingTimeSlotHeaders.length !== timeSlotHeaders.length || existingTimeSlotHeaders.some(function(value, index) {
    return String(value || '').trim().toLowerCase() !== timeSlotHeaders[index];
  });

  if (needsTimeSlotHeader) {
    timeSlotsSheet.getRange(1, 1, 1, timeSlotHeaders.length).setValues([timeSlotHeaders]);
  }

  return timeSlotsSheet;
}

function getAdminPassword() {
  var props = PropertiesService.getScriptProperties();
  return props.getProperty('adminPassword') || 'password123';
}

function setAdminPassword(newPassword) {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('adminPassword', String(newPassword));
}

function getServicePrices() {
  var props = PropertiesService.getScriptProperties();
  var saved = props.getProperty('servicePrices');

  if (!saved) {
    return {
      washer: 60,
      dryer: 60
    };
  }

  try {
    var parsed = JSON.parse(saved);
    return {
      washer: Number(parsed && parsed.washer !== undefined ? parsed.washer : 60),
      dryer: Number(parsed && parsed.dryer !== undefined ? parsed.dryer : 60)
    };
  } catch (err) {
    return {
      washer: 60,
      dryer: 60
    };
  }
}

function setServicePrices(prices) {
  var props = PropertiesService.getScriptProperties();
  var normalized = {
    washer: Number(prices && prices.washer !== undefined ? prices.washer : 60),
    dryer: Number(prices && prices.dryer !== undefined ? prices.dryer : 60)
  };
  props.setProperty('servicePrices', JSON.stringify(normalized));
  return normalized;
}

function getAdminSettings() {
  var props = PropertiesService.getScriptProperties();
  var saved = props.getProperty('adminSettings');
  if (!saved) {
    return {
      title: 'FTTMa Laundry Booking System',
      columnPreferences: ['done', 'timestamp', 'name', 'room_no', 'rented', 'time_rented_washer', 'time_rented_dryer', 'paid_to'],
      bookingAvailabilityState: {
        underMaintenance: false,
        termBreak: false
      }
    };
  }

  try {
    var parsed = JSON.parse(saved);
  } catch (err) {
    parsed = {};
  }

  return {
    title: String(parsed.title || 'FTTMa Laundry Booking System').trim() || 'FTTMa Laundry Booking System',
    columnPreferences: Array.isArray(parsed.columnPreferences) ? parsed.columnPreferences : [],
    bookingAvailabilityState: {
      underMaintenance: !!(parsed.bookingAvailabilityState && parsed.bookingAvailabilityState.underMaintenance),
      termBreak: !!(parsed.bookingAvailabilityState && parsed.bookingAvailabilityState.termBreak)
    }
  };
}

function setAdminSettings(settings) {
  var props = PropertiesService.getScriptProperties();
  var current = getAdminSettings();
  var normalized = {
    title: current.title,
    columnPreferences: Array.isArray(current.columnPreferences) ? current.columnPreferences : [],
    bookingAvailabilityState: {
      underMaintenance: !!(current.bookingAvailabilityState && current.bookingAvailabilityState.underMaintenance),
      termBreak: !!(current.bookingAvailabilityState && current.bookingAvailabilityState.termBreak)
    }
  };

  if (settings && settings.title !== undefined) {
    normalized.title = String(settings.title || '').trim() || normalized.title;
  }

  if (settings && settings.columnPreferences !== undefined) {
    var columns = settings.columnPreferences;
    if (typeof columns === 'string') {
      try {
        columns = JSON.parse(columns);
      } catch (err) {
        columns = [];
      }
    }
    if (Array.isArray(columns)) {
      normalized.columnPreferences = columns;
    }
  }

  if (settings && settings.bookingAvailabilityState !== undefined) {
    var availability = settings.bookingAvailabilityState;
    if (typeof availability === 'string') {
      try {
        availability = JSON.parse(availability);
      } catch (err) {
        availability = {};
      }
    }
    if (availability && typeof availability === 'object') {
      normalized.bookingAvailabilityState = {
        underMaintenance: !!availability.underMaintenance,
        termBreak: !!availability.termBreak
      };
    }
  }

  props.setProperty('adminSettings', JSON.stringify(normalized));
  return normalized;
}

function normalizeWeekendType(value) {
  var normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'saturday' || normalized === 'sunday') {
    return normalized;
  }
  return '';
}

function normalizeVisibleDays(value) {
  return String(value || '')
    .split(',')
    .map(function(day) {
      return String(day || '').trim().toLowerCase();
    })
    .filter(function(day) {
      return day;
    });
}

function formatSheetDate(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  var text = String(value || '').trim();
  if (!text) {
    return '';
  }

  var dateOnlyMatch = text.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (dateOnlyMatch) {
    return dateOnlyMatch[1] + '-' + String(dateOnlyMatch[2]).padStart(2, '0') + '-' + String(dateOnlyMatch[3]).padStart(2, '0');
  }

  var slashMatch = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (slashMatch) {
    return slashMatch[3] + '-' + String(slashMatch[1]).padStart(2, '0') + '-' + String(slashMatch[2]).padStart(2, '0');
  }

  var parsed = new Date(text);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  if (text.indexOf('T') !== -1) {
    return text.split('T')[0];
  }

  return text;
}

function getBookingDataRows() {
  var sheet = getOrCreateBookingsSheet();
  var rows = sheet.getDataRange().getValues();
  if (rows.length === 0) {
    return [];
  }

  var hasHeaderRow = rows[0].some(function(cell) {
    var value = String(cell || '').trim().toLowerCase();
    return value === 'timestamp' || value === 'name' || value === 'room_no' || value === 'rented';
  });

  return hasHeaderRow ? rows.slice(1) : rows;
}

function getManagedTimeSlots() {
  var sheet = getOrCreateTimeSlotsSheet();
  var rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) {
    return [];
  }

  return rows.slice(1).filter(function(row) {
    return String(row[3] || '').trim().toLowerCase() !== 'inactive';
  }).map(function(row) {
    return {
      id: row[0],
      slot_date: formatSheetDate(row[1]),
      slot_time: row[2],
      status: row[3] || 'active',
      slot_weekend_type: normalizeWeekendType(row[4]),
      slot_visible_days: normalizeVisibleDays(row[5]).join(',')
    };
  });
}

function manageTimeSlotsInSheet(actionName, slotData) {
  var sheet = getOrCreateTimeSlotsSheet();
  var rows = sheet.getDataRange().getValues();
  var headers = ['id', 'slot_date', 'slot_time', 'status', 'slot_weekend_type', 'slot_visible_days'];

  if (rows.length === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    rows = sheet.getDataRange().getValues();
  }

  if (actionName === 'add') {
    var newId = String(slotData.slotId || Date.now());
    sheet.appendRow([
      newId,
      slotData.slotDate || '',
      slotData.slotTime || '',
      'active',
      '',
      slotData.slotVisibleDays || ''
    ]);
    SpreadsheetApp.flush();
    return { success: true, id: newId };
  }

  if (actionName === 'edit') {
    var targetId = String(slotData.slotId || '');
    if (!targetId) {
      return { success: false, error: 'Missing slot id' };
    }

    var rowIndex = -1;
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0] || '') === targetId) {
        rowIndex = i;
        break;
      }
    }

    if (rowIndex === -1) {
      return { success: false, error: 'Slot not found' };
    }

    sheet.getRange(rowIndex + 1, 1, 1, headers.length).setValues([[
      targetId,
      slotData.slotDate || '',
      slotData.slotTime || '',
      'active',
      '',
      slotData.slotVisibleDays || ''
    ]]);
    SpreadsheetApp.flush();
    return { success: true, id: targetId };
  }

  if (actionName === 'delete') {
    var deleteId = String(slotData.slotId || '');
    if (!deleteId) {
      return { success: false, error: 'Missing slot id' };
    }

    var deleteRowIndex = -1;
    for (var j = 1; j < rows.length; j++) {
      if (String(rows[j][0] || '') === deleteId) {
        deleteRowIndex = j;
        break;
      }
    }

    if (deleteRowIndex === -1) {
      return { success: false, error: 'Slot not found' };
    }

    sheet.deleteRow(deleteRowIndex + 1);
    SpreadsheetApp.flush();
    return { success: true, id: deleteId };
  }

  return { success: false, error: 'Unsupported action' };
}

function createJsonpOutput(callback, data) {
  var payload = JSON.stringify(data);
  var callbackName = String(callback || 'callback').trim();
  if (!callbackName) {
    return ContentService.createTextOutput(payload).setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput(callbackName + '(' + payload + ')').setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function doGet(e) {
  bookingsSheet = getOrCreateBookingsSheet();
  timeSlotsSheet = getOrCreateTimeSlotsSheet();

  var action = String(e.parameter.action || '').toLowerCase();

  if (action === 'getadminconfig') {
    return createJsonpOutput(e.parameter.callback, {
      password: getAdminPassword()
    });
  }

  if (action === 'getadminsettings') {
    return createJsonpOutput(e.parameter.callback, getAdminSettings());
  }

  if (action === 'getpricing') {
    return createJsonpOutput(e.parameter.callback, getServicePrices());
  }

  if (action === 'savepricing') {
    var updatedPrices = setServicePrices({
      washer: Number(e.parameter.washer || 60),
      dryer: Number(e.parameter.dryer || 60)
    });
    return createJsonpOutput(e.parameter.callback, {
      success: true,
      prices: updatedPrices
    });
  }

  if (action === 'getscheduledata') {
    var bookingRows = getBookingDataRows();
    var bookedSlots = bookingRows.map(function(row) {
      return {
        gender: row[1],
        time_rented_washer: row[5],
        time_rented_dryer: row[4]
      };
    });

    return createJsonpOutput(e.parameter.callback, {
      bookings: bookedSlots,
      timeSlots: getManagedTimeSlots()
    });
  }

  if (action === 'gettimeslots') {
    return createJsonpOutput(e.parameter.callback, {
      timeSlots: getManagedTimeSlots()
    });
  }

  if (action === 'getadmindata') {
    var rows = getBookingDataRows();
    var headers = ['done', 'gender', 'name', 'room_no', 'time_rented_dryer', 'time_rented_washer', 'rented', 'payment_mode', 'paid_to', 'timestamp', 'transaction_no'];

    var allBookings = rows.map(function(row, index) {
      var booking = {};
      headers.forEach(function(header, headerIndex) {
        var value = row[headerIndex];
        if (header === 'timestamp' && value instanceof Date) {
          booking[header] = value.toLocaleString('en-US', { timeZone: 'Asia/Manila' });
        } else if (header === 'done') {
          booking[header] = normalizeBookingDoneValue(value);
        } else {
          booking[header] = value;
        }
      });
      booking.sheet_row = index + 2;
      return booking;
    });

    return createJsonpOutput(e.parameter.callback, allBookings);
  }

  var fallbackRows = getBookingDataRows();
  var fallbackBookedSlots = fallbackRows.map(function(row) {
    return {
      gender: row[1],
      time_rented_washer: row[5],
      time_rented_dryer: row[4]
    };
  });

  return createJsonpOutput(e.parameter.callback, {
    bookings: fallbackBookedSlots,
    timeSlots: getManagedTimeSlots()
  });
}

function getRequestData(e) {
  var contentType = String(e.postData && e.postData.type ? e.postData.type : '').toLowerCase();
  if (contentType.indexOf('application/json') !== -1) {
    try {
      return JSON.parse(e.postData.contents);
    } catch (err) {
      return {};
    }
  }

  if (contentType.indexOf('application/x-www-form-urlencoded') !== -1 || contentType.indexOf('multipart/form-data') !== -1) {
    var params = e.parameter || {};
    var result = {};
    Object.keys(params).forEach(function(key) {
      result[key] = params[key];
    });
    return result;
  }

  return {};
}

function normalizeBookingValue(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeBookingDoneValue(value) {
  var normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return normalized === 'true' || normalized === 'yes' || normalized === '1' || normalized === 'done' || normalized === 'completed';
}

function hasBookingConflict(serviceChoice, washerTime, dryerTime, selectedGender, existingRows) {
  var normalizedWasherTime = String(washerTime || '').trim();
  var normalizedDryerTime = String(dryerTime || '').trim();
  var normalizedSelectedGender = normalizeBookingValue(selectedGender);
  if (!normalizedWasherTime && !normalizedDryerTime) {
    return false;
  }

  return existingRows.some(function(row) {
    var existingGender = normalizeBookingValue(row[1] || '');
    var genderMatches = !normalizedSelectedGender || !existingGender || normalizedSelectedGender === existingGender;
    if (!genderMatches) {
      return false;
    }

    var existingWasherTime = String(row[5] || '').trim();
    var existingDryerTime = String(row[4] || '').trim();

    if (serviceChoice === 'Washer') {
      return normalizedWasherTime && existingWasherTime && normalizeBookingValue(existingWasherTime) === normalizeBookingValue(normalizedWasherTime);
    }

    if (serviceChoice === 'Dryer') {
      return normalizedDryerTime && existingDryerTime && normalizeBookingValue(existingDryerTime) === normalizeBookingValue(normalizedDryerTime);
    }

    return (normalizedWasherTime && existingWasherTime && normalizeBookingValue(existingWasherTime) === normalizeBookingValue(normalizedWasherTime)) ||
      (normalizedDryerTime && existingDryerTime && normalizeBookingValue(existingDryerTime) === normalizeBookingValue(normalizedDryerTime));
  });
}

function generateUniqueTransactionNumber(existingRows) {
  var now = new Date();
  var datePart = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMdd');
  var highestSequence = 0;

  existingRows.forEach(function(row) {
    var transactionValue = String(row[row.length - 1] || '').trim();
    var match = transactionValue.match(/^TXN-(\d{8})-(\d{4})$/);
    if (match && match[1] === datePart) {
      var sequence = Number(match[2] || 0);
      if (sequence > highestSequence) {
        highestSequence = sequence;
      }
    }
  });

  return 'TXN-' + datePart + '-' + String(highestSequence + 1).padStart(4, '0');
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  var lockAcquired = lock.tryLock(10000);

  if (!lockAcquired) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'Booking is still being processed. Please try again in a moment.' })).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    bookingsSheet = getOrCreateBookingsSheet();
    timeSlotsSheet = getOrCreateTimeSlotsSheet();

    var data = getRequestData(e);
    var actionName = String(data.action || '').trim().toLowerCase();

    if (actionName === 'savebooking') {
      var existingRows = getBookingDataRows();
      var serviceChoice = String(data.rented || '').trim();
      var washerTimeValue = String(data.time_rented_washer || '');
      var dryerTimeValue = String(data.time_rented_dryer || '');

      if (hasBookingConflict(serviceChoice, washerTimeValue, dryerTimeValue, data.gender, existingRows)) {
        return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'This slot has already been booked. Please choose a different time.' })).setMimeType(ContentService.MimeType.JSON);
      }

      var transactionNumber = String(data.transaction_no || '').trim();
      if (!transactionNumber) {
        transactionNumber = generateUniqueTransactionNumber(existingRows);
      }

      bookingsSheet.appendRow([
        'false',
        data.gender,
        data.name,
        data.room_no,
        dryerTimeValue,
        washerTimeValue,
        serviceChoice,
        data.payment_mode,
        data.paid_to,
        data.timestamp,
        transactionNumber
      ]);
      SpreadsheetApp.flush();
      return ContentService.createTextOutput(JSON.stringify({ success: true, message: 'Booking saved', transaction_no: transactionNumber })).setMimeType(ContentService.MimeType.JSON);
    }

    if (actionName === 'savepricing') {
      var updatedPrices = setServicePrices({
        washer: Number(data.washer || 60),
        dryer: Number(data.dryer || 60)
      });
      return ContentService.createTextOutput(JSON.stringify({ success: true, prices: updatedPrices })).setMimeType(ContentService.MimeType.JSON);
    }

    if (actionName === 'saveadminsettings') {
      var updatedSettings = setAdminSettings({
        title: data.title,
        columnPreferences: data.columnPreferences,
        bookingAvailabilityState: data.bookingAvailabilityState
      });
      return ContentService.createTextOutput(JSON.stringify({ success: true, settings: updatedSettings })).setMimeType(ContentService.MimeType.JSON);
    }

    if (actionName === 'updatebookingstatus') {
      var bookingRowNumber = Number(data.rowNumber || 0);
      if (!bookingRowNumber) {
        return ContentService.createTextOutput(JSON.stringify({ success: false, error: 'Missing booking row number' })).setMimeType(ContentService.MimeType.JSON);
      }

      var doneColumnIndex = 1;
      bookingsSheet.getRange(bookingRowNumber, doneColumnIndex).setValue(String(data.done || '').toLowerCase() === 'true' ? 'true' : 'false');
      SpreadsheetApp.flush();
      return ContentService.createTextOutput(JSON.stringify({ success: true, message: 'Booking status updated' })).setMimeType(ContentService.MimeType.JSON);
    }

    if (actionName === 'managetimeslots') {
      var result = manageTimeSlotsInSheet(String(data.mode || '').toLowerCase(), {
        slotId: data.slotId,
        slotDate: data.slotDate,
        slotTime: data.slotTime,
        slotVisibleDays: data.slotVisibleDays
      });
      return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
    }

    if (actionName === 'changeadminpassword') {
      var currentPassword = String(data.currentPassword || '');
      var newPassword = String(data.newPassword || '');

      if (!currentPassword || !newPassword) {
        return ContentService.createTextOutput('Missing password data').setMimeType(ContentService.MimeType.TEXT);
      }

      if (currentPassword !== getAdminPassword()) {
        return ContentService.createTextOutput('Current password is invalid').setMimeType(ContentService.MimeType.TEXT);
      }

      if (newPassword.length < 4) {
        return ContentService.createTextOutput('Password too short').setMimeType(ContentService.MimeType.TEXT);
      }

      setAdminPassword(newPassword);
      SpreadsheetApp.flush();
      return ContentService.createTextOutput('Password updated').setMimeType(ContentService.MimeType.TEXT);
    }

    var fallbackTransactionNumber = String(data.transaction_no || '').trim();
    if (!fallbackTransactionNumber) {
      fallbackTransactionNumber = generateUniqueTransactionNumber(getBookingDataRows());
    }

    bookingsSheet.appendRow([
      'false',
      data.gender,
      data.name,
      data.room_no,
      data.time_rented_dryer,
      data.time_rented_washer,
      data.rented,
      data.payment_mode,
      data.paid_to,
      data.timestamp,
      fallbackTransactionNumber
    ]);
    SpreadsheetApp.flush();
    return ContentService.createTextOutput(JSON.stringify({ success: true, message: 'Success' })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    Logger.log(error.toString());
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: error.toString() })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    if (lockAcquired) {
      lock.releaseLock();
    }
  }
}