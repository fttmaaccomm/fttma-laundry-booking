const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxJxoKe5JFN7KE5Zq_ZLSPgiq9QEh6SW7AkhjKKAh0TDDS--GZcqSb1lw0qLSb5unQZwA/exec";
    
    const DEFAULT_WASHER_PRICE = 60;
    const DEFAULT_DRYER_PRICE = 60;
    const ADMIN_USERNAME = 'admin';
    let adminPassword = null;
    let washerPrice = DEFAULT_WASHER_PRICE;
    let dryerPrice = DEFAULT_DRYER_PRICE;
    let adminMainPageTitle = 'FTTMa Laundry Booking System';
    let bookingAvailabilityState = { underMaintenance: false, termBreak: false };
    let adminBookingColumnPreferences = getDefaultAdminBookingColumns();
    let autoRefreshTimer = null;
    let autoRefreshInProgress = false;

    function postToScript(payload) {
        const searchParams = new URLSearchParams();
        Object.keys(payload || {}).forEach(function(key) {
            var value = payload[key];
            if (value !== undefined && value !== null) {
                if (typeof value === 'object') {
                    value = JSON.stringify(value);
                }
                searchParams.append(key, String(value));
            }
        });

        return fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            mode: 'cors',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body: searchParams.toString()
        }).then(async function(response) {
            const contentType = response.headers.get('content-type') || '';
            let parsedBody = null;

            if (contentType.includes('application/json')) {
                parsedBody = await response.json();
            } else {
                const textBody = await response.text();
                try {
                    parsedBody = JSON.parse(textBody);
                } catch (err) {
                    parsedBody = textBody;
                }
            }

            if (!response.ok) {
                return { success: false, error: 'The request could not be completed.' };
            }

            if (parsedBody && typeof parsedBody === 'object' && 'success' in parsedBody) {
                return parsedBody;
            }

            return { success: true, payload: parsedBody };
        }).catch(function(err) {
            return { success: false, error: err && err.message ? err.message : 'Request failed' };
        });
    }

    function getStoredTimeSlots() {
        return [];
    }

    function getStoredPrices() {
        return {
            washer: DEFAULT_WASHER_PRICE,
            dryer: DEFAULT_DRYER_PRICE
        };
    }

    function persistPrices(prices) {
        return postToScript({
            action: 'savePricing',
            washer: prices.washer,
            dryer: prices.dryer
        });
    }

    function loadPricesFromServer(callback, silent = false) {
        return new Promise(function(resolve) {
            const callbackName = 'onPricesLoaded' + Date.now();
            window[callbackName] = function(data) {
                delete window[callbackName];
                const nextPrices = {
                    washer: Number(data && data.washer !== undefined ? data.washer : DEFAULT_WASHER_PRICE),
                    dryer: Number(data && data.dryer !== undefined ? data.dryer : DEFAULT_DRYER_PRICE)
                };
                washerPrice = nextPrices.washer;
                dryerPrice = nextPrices.dryer;
                applyPricingToUI();
                if (callback) callback(nextPrices);
                resolve(nextPrices);
            };

            const script = document.createElement('script');
            script.src = GOOGLE_SCRIPT_URL + "?action=getPricing&callback=" + callbackName + "&t=" + Date.now();
            script.onerror = function() {
                delete window[callbackName];
                const fallbackPrices = getStoredPrices();
                washerPrice = fallbackPrices.washer;
                dryerPrice = fallbackPrices.dryer;
                applyPricingToUI();
                if (callback) callback(fallbackPrices);
                resolve(fallbackPrices);
                if (!silent) {
                    showWarningModal('Could not load pricing. Please refresh the page if needed.');
                }
            };
            script.onload = function() {
                document.body.removeChild(script);
            };
            document.body.appendChild(script);
        });
    }

    function applyPricingToUI() {
        const priceValues = {
            washer: Number.isFinite(washerPrice) ? washerPrice : DEFAULT_WASHER_PRICE,
            dryer: Number.isFinite(dryerPrice) ? dryerPrice : DEFAULT_DRYER_PRICE
        };
        washerPrice = Number.isFinite(priceValues.washer) ? priceValues.washer : DEFAULT_WASHER_PRICE;
        dryerPrice = Number.isFinite(priceValues.dryer) ? priceValues.dryer : DEFAULT_DRYER_PRICE;
        const washerInput = document.getElementById('washerPriceInput');
        const dryerInput = document.getElementById('dryerPriceInput');
        if (washerInput) washerInput.value = washerPrice;
        if (dryerInput) dryerInput.value = dryerPrice;
        const washerLabel = document.getElementById('washerPriceLabel');
        const dryerLabel = document.getElementById('dryerPriceLabel');
        const bothLabel = document.getElementById('bothPriceLabel');
        if (washerLabel) washerLabel.textContent = `(₱${washerPrice.toFixed(2)})`;
        if (dryerLabel) dryerLabel.textContent = `(₱${dryerPrice.toFixed(2)})`;
        if (bothLabel) bothLabel.textContent = `(₱${(washerPrice + dryerPrice).toFixed(2)})`;
    }

    function persistTimeSlots() {
        return null;
    }

    function mergeTimeSlots(remoteSlots) {
        const remoteList = Array.isArray(remoteSlots) ? remoteSlots : [];
        return remoteList.map(slot => ({ ...slot }));
    }

    function loadAdminPassword(callback) {
        if (adminPassword !== null) {
            callback(adminPassword);
            return;
        }

        window.onAdminPasswordLoaded = function(data) {
            adminPassword = data && data.password ? data.password : 'password123';
            callback(adminPassword);
        };

        const script = document.createElement('script');
        script.src = GOOGLE_SCRIPT_URL + "?action=getAdminConfig&callback=onAdminPasswordLoaded&t=" + Date.now();
        script.onerror = () => {
            adminPassword = 'password123';
            callback(adminPassword);
        };
        script.onload = () => {
            document.body.removeChild(script);
        };
        document.body.appendChild(script);
    }

    function saveAdminSettings(payload) {
        return postToScript(Object.assign({ action: 'saveAdminSettings' }, payload));
    }

    function loadAdminSettings(callback, silent = false) {
        const callbackName = 'onAdminSettingsLoaded' + Date.now();
        window[callbackName] = function(data) {
            delete window[callbackName];
            // Update in-memory values. If silent, avoid applying any UI changes
            // that would be visible to non-admin users (title/overlays). Only
            // re-render the admin table when the admin panel is open.
            const title = data && typeof data.title === 'string' && data.title.trim() ? data.title.trim() : 'FTTMa Laundry Booking System';
            adminMainPageTitle = title;

            if (Array.isArray(data && data.columnPreferences)) {
                const validKeys = new Set(getAdminBookingColumnConfig().map(function(column) {
                    return column.key;
                }));
                const filteredColumns = data.columnPreferences.filter(function(key) {
                    return typeof key === 'string' && validKeys.has(key);
                });
                if (filteredColumns.length) {
                    adminBookingColumnPreferences = filteredColumns;
                }
            }

            if (data && typeof data.bookingAvailabilityState === 'object' && data.bookingAvailabilityState !== null) {
                bookingAvailabilityState = {
                    underMaintenance: !!data.bookingAvailabilityState.underMaintenance,
                    termBreak: !!data.bookingAvailabilityState.termBreak
                };
            }

            // Apply visible UI updates only when not silent.
            if (!silent) {
                setMainPageTitle(adminMainPageTitle);
                updateBookingAvailabilityUI();
                if (callback) {
                    callback(data);
                }
            } else {
                // Silent update: if admin panel is visible, refresh admin table silently
                const adminPanel = document.getElementById('adminPanel');
                const isAdminVisible = !!(adminPanel && !adminPanel.classList.contains('hidden'));
                if (isAdminVisible) {
                    // Ensure columns/state applied and table refreshed without user-facing notifications
                    try {
                        applyFiltersAndRender();
                    } catch (e) {
                        // Swallow errors during silent refresh
                        console.debug('Silent admin settings refresh error', e);
                    }
                }
                if (callback) {
                    callback(data);
                }
            }
        };

        const script = document.createElement('script');
        script.src = GOOGLE_SCRIPT_URL + "?action=getAdminSettings&callback=" + callbackName + "&t=" + Date.now();
        script.onerror = function() {
            delete window[callbackName];
            if (!silent) {
                showWarningModal('Could not load admin settings. Please refresh the page if needed.');
            }
            if (callback) {
                callback(null);
            }
        };
        script.onload = function() {
            document.body.removeChild(script);
        };
        document.body.appendChild(script);
    }

    let lastBookingData = {}; // To store the data for the email receipt
    let selectedWasherTime = "Not Selected / Not Rented";
    let selectedDryerTime = "Not Selected / Not Rented";
    let statusToastTimer = null;
    
    let bookedSlots = [];
    let existingBookingReferences = [];

    let loadingRequestCount = 0;

    function showLoading(message = 'Please wait while the request is being completed.') {
        document.getElementById('loadingMessage').textContent = message;
        loadingRequestCount = Math.max(0, loadingRequestCount + 1);
        document.getElementById('loadingOverlay').classList.add('show');
    }

    function hideLoading() {
        loadingRequestCount = Math.max(0, loadingRequestCount - 1);
        if (loadingRequestCount <= 0) {
            loadingRequestCount = 0;
            document.getElementById('loadingOverlay').classList.remove('show');
        }
    }

    function getBookingAvailabilityState() {
        return {
            underMaintenance: !!(bookingAvailabilityState && bookingAvailabilityState.underMaintenance),
            termBreak: !!(bookingAvailabilityState && bookingAvailabilityState.termBreak)
        };
    }

    function persistBookingAvailabilityState(nextState) {
        bookingAvailabilityState = {
            underMaintenance: !!(nextState && nextState.underMaintenance),
            termBreak: !!(nextState && nextState.termBreak)
        };
        return saveAdminSettings({ bookingAvailabilityState: bookingAvailabilityState })
            .then(function(result) {
                if (!result || result.success === false) {
                    showWarningModal('Unable to sync booking availability state. Changes are still applied locally in this session.');
                }
            });
    }

    function getActiveBookingNotice() {
        if (bookingAvailabilityState.termBreak) {
            return {
                title: 'Term Break',
                message: 'Sorry, the system does not process any transactions right now.'
            };
        }
        if (bookingAvailabilityState.underMaintenance) {
            return {
                title: 'Under Maintenance',
                message: 'The booking system is under maintenance. New reservations are temporarily unavailable.'
            };
        }
        return null;
    }

    function updateBookingAvailabilityUI() {
        const notice = getActiveBookingNotice();
        const overlay = document.getElementById('bookingStatusOverlay');
        const titleEl = document.getElementById('bookingStatusTitle');
        const messageEl = document.getElementById('bookingStatusMessage');
        const badgeEl = document.getElementById('bookingStatusBadge');
        const maintenanceToggle = document.getElementById('maintenanceToggle');
        const termBreakToggle = document.getElementById('termBreakToggle');
        const adminPanel = document.getElementById('adminPanel');
        const isAdminVisible = !!(adminPanel && !adminPanel.classList.contains('hidden'));

        if (maintenanceToggle) maintenanceToggle.checked = !!bookingAvailabilityState.underMaintenance;
        if (termBreakToggle) termBreakToggle.checked = !!bookingAvailabilityState.termBreak;

        if (badgeEl) {
            badgeEl.textContent = notice ? (notice.title === 'Term Break' ? 'Term Break' : 'Maintenance') : 'Open';
            badgeEl.style.background = notice ? 'linear-gradient(135deg, rgba(248, 113, 113, 0.2), rgba(37, 99, 235, 0.16))' : 'linear-gradient(135deg, rgba(34, 197, 94, 0.16), rgba(47, 128, 237, 0.12))';
            badgeEl.style.color = notice ? '#b45309' : '#166534';
        }

        if (overlay && titleEl && messageEl) {
            if (notice && !isAdminVisible) {
                titleEl.textContent = notice.title;
                messageEl.textContent = notice.message;
                overlay.classList.remove('hidden');
            } else {
                overlay.classList.add('hidden');
            }
        }
    }

    function applyBookingAvailabilityState() {
        bookingAvailabilityState = getBookingAvailabilityState();
        updateBookingAvailabilityUI();
    }

    function showStatusToast(message, title = 'Status Updated') {
        const toast = document.getElementById('statusToast');
        if (!toast) {
            return;
        }
        toast.innerHTML = `<strong>${title}</strong><span>${message}</span>`;
        toast.classList.add('show');
        if (statusToastTimer) {
            clearTimeout(statusToastTimer);
        }
        statusToastTimer = setTimeout(function() {
            toast.classList.remove('show');
        }, 3200);
    }

    function toggleBookingAvailability(flagName, isEnabled) {
        const previousState = { ...bookingAvailabilityState };
        bookingAvailabilityState = {
            underMaintenance: flagName === 'underMaintenance' ? isEnabled : bookingAvailabilityState.underMaintenance,
            termBreak: flagName === 'termBreak' ? isEnabled : bookingAvailabilityState.termBreak
        };
        persistBookingAvailabilityState(bookingAvailabilityState);
        updateBookingAvailabilityUI();

        if (flagName === 'underMaintenance') {
            const message = isEnabled
                ? 'Under maintenance mode is now enabled. New bookings are blocked while admin access remains available.'
                : 'Under maintenance mode is now disabled. Bookings are open again.';
            showStatusToast(message, 'Booking Status Updated');
        }

        if (flagName === 'termBreak') {
            const message = isEnabled
                ? 'Term break mode is now enabled. No new bookings will be accepted until it is turned off.'
                : 'Term break mode is now disabled. Bookings are open again.';
            showStatusToast(message, 'Booking Status Updated');
        }

        if (previousState.underMaintenance === bookingAvailabilityState.underMaintenance && previousState.termBreak === bookingAvailabilityState.termBreak) {
            return;
        }
    }

    function showWarningModal(message, title = 'Warning') {
        const normalizedTitle = String(title || 'Warning').trim().toLowerCase();
        const isSuccess = normalizedTitle === 'success' || normalizedTitle === 'done' || normalizedTitle === 'completed';
        const iconEl = document.getElementById('warningIcon');

        document.getElementById('warningTitle').textContent = title;
        document.getElementById('warningMessage').textContent = message;
        iconEl.textContent = isSuccess ? '✓' : '!';
        iconEl.className = `warning-icon ${isSuccess ? 'success' : 'warning'}`;
        document.getElementById('warningModal').classList.add('show');
    }

    function closeWarningModal() {
        document.getElementById('warningModal').classList.remove('show');
    }

    function openPasswordModal() {
        document.getElementById('passwordModal').classList.add('show');
    }

    function closePasswordModal() {
        document.getElementById('passwordModal').classList.remove('show');
        document.getElementById('changePasswordForm').reset();
    }

    function openPricingModal() {
        const washerInput = document.getElementById('washerPriceInput');
        const dryerInput = document.getElementById('dryerPriceInput');
        if (washerInput) washerInput.value = washerPrice;
        if (dryerInput) dryerInput.value = dryerPrice;
        document.getElementById('pricingModal').classList.add('show');
    }

    function closePricingModal() {
        document.getElementById('pricingModal').classList.remove('show');
    }
    let inactivityTimer;

    function loadScheduleDataFromServer(refreshMainSchedule = true, silent = false) {
        return new Promise(function(resolve) {
            window.onDataLoaded = function(data) {
                const normalizedData = Array.isArray(data) ? data : (data && data.bookings ? data.bookings : []);
                bookedSlots = normalizedData || [];
                const remoteSlots = Array.isArray(data && data.timeSlots) ? data.timeSlots : [];
                adminTimeSlotsData = mergeTimeSlots(remoteSlots);

                if (refreshMainSchedule) {
                    buildSchedule('washerTable', 'washerSlot');
                    buildSchedule('dryerTable', 'dryerSlot');
                }
                resolve(true);
            };

            const script = document.createElement('script');
            script.src = GOOGLE_SCRIPT_URL + "?action=getScheduleData&callback=onDataLoaded&t=" + Date.now();
            script.onerror = () => {
                console.error("Failed to load schedule data from Google Sheets.");
                if (!silent) {
                    showWarningModal("Could not load schedule data. Please check your connection and refresh the page.");
                }
                resolve(false);
            };
            script.onload = () => {
                document.body.removeChild(script);
            };
            document.body.appendChild(script);
        });
    }

    function startSeamlessAutoRefresh() {
        if (autoRefreshTimer) {
            clearInterval(autoRefreshTimer);
        }
        autoRefreshTimer = null;
    }

    // Background admin sync: keep admin settings and admin table refreshed
    // without showing visible UI changes to normal users. When the admin
    // panel is open, silently refresh the admin table.
    let adminSyncIntervalId = null;
    function startAdminBackgroundSync(intervalMs = 5000) {
        if (adminSyncIntervalId) {
            clearInterval(adminSyncIntervalId);
        }
        adminSyncIntervalId = setInterval(function() {
            try {
                // Keep admin settings refreshed in the background for all devices.
                // Visible availability notices must update even when the page is not reloaded.
                loadAdminSettings(null, false);
            } catch (e) {
                // ignore
            }
        }, intervalMs);
    }

    function stopAdminBackgroundSync() {
        if (adminSyncIntervalId) {
            clearInterval(adminSyncIntervalId);
            adminSyncIntervalId = null;
        }
    }

    function refreshLivePageData() {
        if (autoRefreshInProgress) {
            return Promise.resolve(false);
        }
        autoRefreshInProgress = true;

        const requests = [
            loadPricesFromServer(null, true).catch(function() { return null; }),
            loadScheduleDataFromServer(true, true).catch(function() { return null; })
        ];

        return Promise.all(requests).finally(function() {
            autoRefreshInProgress = false;
        });
    }

    window.onload = function() {
        const pricingValues = getStoredPrices();
        washerPrice = pricingValues.washer;
        dryerPrice = pricingValues.dryer;
        applyPricingToUI();
        loadAdminSettings(function() {
            applyFiltersAndRender();
        }, false);
        startAdminBackgroundSync(5000);
        loadPricesFromServer();
        loadScheduleDataFromServer(true);

        document.querySelectorAll('input[name="gender"]').forEach(function(radio) {
            radio.addEventListener('change', function() {
                buildSchedule('washerTable', 'washerSlot');
                buildSchedule('dryerTable', 'dryerSlot');
            });
        });

        // Start the inactivity timer when the page loads
        resetInactivityTimer();
        ['click', 'keypress', 'touchstart'].forEach(evt => document.addEventListener(evt, resetInactivityTimer, false));
    };
    function normalize(str){
    return String(str)
        .trim()
        .replace(/\s+/g," ")
        .toLowerCase();
    }

    function normalizeReference(value) {
        return String(value || '').trim().toLowerCase();
    }

    function getSelectedGenderValue() {
        const selectedGender = document.querySelector('input[name="gender"]:checked');
        return selectedGender ? normalize(selectedGender.value) : '';
    }

    function loadBookingReferences(callback) {
        if (existingBookingReferences.length > 0) {
            callback(existingBookingReferences);
            return;
        }

        window.onReferenceDataLoaded = function(data) {
            existingBookingReferences = data || [];
            callback(existingBookingReferences);
        };

        const script = document.createElement('script');
        script.src = GOOGLE_SCRIPT_URL + "?action=getAdminData&callback=onReferenceDataLoaded&t=" + Date.now();
        script.onerror = () => {
            callback(null);
        };
        script.onload = () => {
            document.body.removeChild(script);
        };
        document.body.appendChild(script);
    }

    function checkReferenceDuplicate(referenceValue, callback) {
        const normalizedReference = normalizeReference(referenceValue);
        if (!normalizedReference) {
            callback(false);
            return;
        }

        loadBookingReferences(function(data) {
            if (!data) {
                callback(null);
                return;
            }

            const isDuplicate = data.some(function(booking) {
                return normalizeReference(booking.paid_to) === normalizedReference;
            });

            callback(isDuplicate);
        });
    }

    function getSlotVisibleDays(slot) {
        const value = String(slot && slot.slot_visible_days ? slot.slot_visible_days : '').trim();
        if (!value) {
            const weekendType = String(slot && slot.slot_weekend_type ? slot.slot_weekend_type : '').trim().toLowerCase();
            return weekendType ? [weekendType] : [];
        }
        return value.split(',').map(day => day.trim().toLowerCase()).filter(Boolean);
    }

    function getSlotDayLabel(slot) {
        const visibleDays = getSlotVisibleDays(slot);
        if (!visibleDays.length) return '';
        const labels = visibleDays.map(day => day.charAt(0).toUpperCase() + day.slice(1));
        return labels.join(', ');
    }

    function isSlotAvailableForDay(slot, currentDayNormalized) {
        const visibleDays = getSlotVisibleDays(slot);
        if (!visibleDays.length) return true;
        const day = currentDayNormalized.getDay();
        const dayNameMap = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        return visibleDays.includes(dayNameMap[day]);
    }

    function parseSlotDateValue(value) {
        if (!value && value !== 0) return null;
        if (value instanceof Date) return value;

        const text = String(value || '').trim();
        if (!text) return null;

        const dateOnlyMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (dateOnlyMatch) {
            const [_, year, month, day] = dateOnlyMatch;
            return new Date(Number(year), Number(month) - 1, Number(day));
        }

        const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (slashMatch) {
            const [_, month, day, year] = slashMatch;
            return new Date(Number(year), Number(month) - 1, Number(day));
        }

        const monthNameMatch = text.match(/([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/i);
        if (monthNameMatch) {
            const monthNames = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
            const monthIndex = monthNames.indexOf(monthNameMatch[1].slice(0, 3).toLowerCase());
            if (monthIndex >= 0) {
                return new Date(Number(monthNameMatch[3]), monthIndex, Number(monthNameMatch[2]));
            }
        }

        const parsed = new Date(text);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    function getDateKey(value) {
        const parsed = parseSlotDateValue(value);
        if (!parsed) return null;
        const year = parsed.getFullYear();
        const month = String(parsed.getMonth() + 1).padStart(2, '0');
        const day = String(parsed.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function isSlotSelected(classPrefix, fullDateTimeString) {
        if (classPrefix === 'washerSlot') {
            return selectedWasherTime === fullDateTimeString;
        }
        if (classPrefix === 'dryerSlot') {
            return selectedDryerTime === fullDateTimeString;
        }
        return false;
    }

    function buildSchedule(tableId, classPrefix) {
        const tbody = document.getElementById(tableId).getElementsByTagName('tbody')[0];
        tbody.innerHTML = "";

        const todayNormalized = new Date(new Date().setHours(0, 0, 0, 0));
        const startDayNormalized = new Date(todayNormalized);
        startDayNormalized.setDate(startDayNormalized.getDate() + 1);

        for (let i = 0; i < 14; i++) {
            const currentDay = new Date(startDayNormalized);
            currentDay.setDate(currentDay.getDate() + i);

            const currentDayNormalized = new Date(currentDay.getFullYear(), currentDay.getMonth(), currentDay.getDate());
            const dateString = currentDay.toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' });
            const row = tbody.insertRow();
            row.className = 'schedule-day-row';
            const dateCell = row.insertCell(0);
            const weekdayLabel = currentDay.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
            const dayLabel = currentDay.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            dateCell.innerHTML = `<div class="schedule-date-pill"><span class="day-name">${weekdayLabel}</span><span>${dayLabel}</span></div>`;

            const slotsCell = row.insertCell(1);
            const isPastDay = currentDayNormalized < startDayNormalized;
            const dateDisabledByCalendar = isPastDay;

            let timesToRender = [];
            if (adminTimeSlotsData && adminTimeSlotsData.length > 0) {
                const slotsWithTime = adminTimeSlotsData
                    .filter(slot => String(slot.slot_time || '').trim())
                    .sort((a, b) => String(a.slot_time || '').localeCompare(String(b.slot_time || '')));

                const currentDateKey = getDateKey(currentDayNormalized);
                const currentDayName = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][currentDayNormalized.getDay()];

                const matchingSlots = slotsWithTime.filter(slot => {
                    const slotDate = String(slot.slot_date || '').trim();
                    if (slotDate) {
                        const slotDateKey = getDateKey(slotDate);
                        if (!slotDateKey) return false;
                        return slotDateKey === currentDateKey;
                    }

                    const visibleDays = getSlotVisibleDays(slot);
                    if (!visibleDays.length) return true;
                    return visibleDays.includes(currentDayName);
                });

                const generalSlots = slotsWithTime.filter(slot => {
                    const slotDate = String(slot.slot_date || '').trim();
                    return !slotDate && !getSlotVisibleDays(slot).length;
                });

                timesToRender = [...matchingSlots, ...generalSlots].map(slot => ({
                    slotTime: String(slot.slot_time || '').trim(),
                    slot
                }));
            }

            if (timesToRender.length === 0) {
                timesToRender = [];
            }

            timesToRender.forEach(({ slotTime, slot }) => {
                const uniqueText = `${dateString} @ ${slotTime}`;
                const selectedGender = getSelectedGenderValue();
                const isAlreadyBooked = classPrefix === 'washerSlot'
                    ? bookedSlots.some(function(b){
                        const bookingGender = normalize(b.gender || '');
                        const matchesGender = !selectedGender || !bookingGender || bookingGender === selectedGender;
                        return matchesGender && normalize(b.time_rented_washer) === normalize(uniqueText);
                    })
                    : bookedSlots.some(function(b){
                        const bookingGender = normalize(b.gender || '');
                        const matchesGender = !selectedGender || !bookingGender || bookingGender === selectedGender;
                        return matchesGender && normalize(b.time_rented_dryer) === normalize(uniqueText);
                    });

                const visibleDays = getSlotVisibleDays(slot);
                const isDayRestricted = Boolean(visibleDays.length);
                const isAvailableForDay = isSlotAvailableForDay(slot, currentDayNormalized);
                const displayLabel = slotTime;

                if (isAlreadyBooked) {
                    slotsCell.innerHTML += `<button type="button" class="time-slot-btn" style="background: #e74c3c; color: white; border-color: #e74c3c; cursor: not-allowed;" disabled>BOOKED 🔒</button><div style="margin-bottom:6px;"></div>`;
                } else if (dateDisabledByCalendar) {
                    slotsCell.innerHTML += `<button type="button" class="time-slot-btn" style="border-color: #bdc3c7; color: #bdc3c7; cursor: not-allowed;" disabled>${slotTime}</button><div style="margin-bottom:6px;"></div>`;
                } else if (isDayRestricted && !isAvailableForDay) {
                    slotsCell.innerHTML += `<button type="button" class="time-slot-btn" style="border-color: #bdc3c7; color: #bdc3c7; cursor: not-allowed;" disabled>${displayLabel}</button><div style="margin-bottom:6px;"></div>`;
                } else {
                    const isSelected = isSlotSelected(classPrefix, uniqueText);
                    const buttonClasses = `time-slot-btn ${classPrefix}${isSelected ? ' selected' : ''}`;
                    slotsCell.innerHTML += `<button type="button" class="${buttonClasses}" onclick="selectSlot(this, '${classPrefix}', '${uniqueText}')">${displayLabel}</button><div style="margin-bottom:6px;"></div>`;
                }
            });
        }
    }

    function selectSlot(buttonElement, classPrefix, fullDateTimeString) {
        document.querySelectorAll('.' + classPrefix).forEach(btn => btn.classList.remove('selected'));
        buttonElement.classList.add('selected');

        if(classPrefix === 'washerSlot') { selectedWasherTime = fullDateTimeString; }
        if(classPrefix === 'dryerSlot') { selectedDryerTime = fullDateTimeString; }
    }

    function toggleSchedules() {
        const choice = document.querySelector('input[name="rented"]:checked').value;
        const isWasherActive = choice === 'Washer' || choice === 'Both';
        const isDryerActive = choice === 'Dryer' || choice === 'Both';
        
        document.getElementById('washerScheduleSection').classList.toggle('disabled', !isWasherActive);
        document.getElementById('dryerScheduleSection').classList.toggle('disabled', !isDryerActive);

        resetSelectionsAndButtons();
    }

    function togglePaymentFields() {
        const choice = document.querySelector('input[name="paymentMode"]:checked').value;
        const cashInput = document.getElementById('paidToCash');
        const gcashInput = document.getElementById('paidToGcash');

        document.getElementById('cashFields').classList.add('hidden');
        document.getElementById('gcashFields').classList.add('hidden');

        if (choice === 'Cash') {
            document.getElementById('cashFields').classList.remove('hidden');
            gcashInput.value = '';
            gcashInput.required = false;
            cashInput.required = true;
        } else if (choice === 'GCash') {
            document.getElementById('gcashFields').classList.remove('hidden');
            cashInput.value = '';
            cashInput.required = false;
            gcashInput.required = true;
        }

        validatePaymentForm();
    }

    function validatePaymentForm() {
        const confirmBtn = document.getElementById('submitBtn');
        const paymentMode = document.querySelector('input[name="paymentMode"]:checked');
        const cashInput = document.getElementById('paidToCash');
        const gcashInput = document.getElementById('paidToGcash');

        let isValid = false;

        if (paymentMode) {
            if (paymentMode.value === 'Cash' && cashInput.value.trim() !== '' && cashInput.checkValidity()) {
                isValid = true;
            } else if (paymentMode.value === 'GCash' && gcashInput.value.trim() !== '') {
                isValid = true;
            }
        }

        // Enable or disable the button based on validity
        confirmBtn.disabled = !isValid;
    }

    function getPriceDetails(serviceChosen) {
        const services = serviceChosen === 'Both' ? ['Washer', 'Dryer'] : [serviceChosen];
        const serviceLines = services.map(service => `${service}: ₱${service === 'Dryer' ? dryerPrice : washerPrice}`);
        const total = services.reduce((sum, service) => sum + (service === 'Dryer' ? dryerPrice : washerPrice), 0);
        return {
            lines: serviceLines,
            total: total,
            text: `${serviceLines.join(' | ')} | Total: ₱${total}`
        };
    }

    function resetSelectionsAndButtons() {
        // Reset global time variables
        selectedWasherTime = "Not Selected / Not Rented";
        selectedDryerTime = "Not Selected / Not Rented";

        // Remove 'selected' class from all time slot buttons
        document.querySelectorAll('.time-slot-btn.selected').forEach(btn => {
            btn.classList.remove('selected');
        });
    }

    function autoCancel() {
        // Only reset if the user is on the main form screen
        if (!document.getElementById('formScreen').classList.contains('hidden')) {
            console.log("User inactive, resetting form.");
            document.getElementById('bookingForm').reset();
            resetSelectionsAndButtons();
            document.getElementById('washerScheduleSection').classList.add('disabled');
            document.getElementById('dryerScheduleSection').classList.add('disabled');
        }
    }

    function resetInactivityTimer() {
        clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(autoCancel, 5 * 60 * 1000); // 5 minutes
    }

    document.getElementById('cancelBtn').addEventListener('click', function() {
        document.getElementById('bookingForm').reset();
        resetSelectionsAndButtons();
        document.getElementById('washerScheduleSection').classList.add('disabled');
        document.getElementById('dryerScheduleSection').classList.add('disabled');
    });

    // Add listener for the new mobile cancel button
    document.getElementById('cancelBtnMobile').addEventListener('click', function() {
        document.getElementById('bookingForm').reset();
        resetSelectionsAndButtons();
        document.getElementById('washerScheduleSection').classList.add('disabled');
        document.getElementById('dryerScheduleSection').classList.add('disabled');
    });

    document.getElementById('savePricingBtn').addEventListener('click', function() {
        showLoading('Saving pricing...');
        const nextPrices = {
            washer: Number(document.getElementById('washerPriceInput').value || DEFAULT_WASHER_PRICE),
            dryer: Number(document.getElementById('dryerPriceInput').value || DEFAULT_DRYER_PRICE)
        };
        persistPrices(nextPrices).then(function(result) {
            if (result && result.success !== false) {
                washerPrice = nextPrices.washer;
                dryerPrice = nextPrices.dryer;
                applyPricingToUI();
                closePricingModal();
                showWarningModal('Pricing updated successfully.', 'Success');
                return loadPricesFromServer();
            }
            hideLoading();
            showWarningModal('Could not save pricing. Please try again.');
        }).catch(function() {
            hideLoading();
            showWarningModal('Could not save pricing. Please try again.');
        }).finally(function() {
            hideLoading();
        });
    });

    document.getElementById('closePricingModalBtn').addEventListener('click', closePricingModal);
    document.getElementById('openPricingModalBtn').addEventListener('click', openPricingModal);

    document.getElementById('bookingForm').addEventListener('submit', function(e) {
        e.preventDefault();

        const activeNotice = getActiveBookingNotice();
        if (activeNotice) {
            showWarningModal(activeNotice.message, activeNotice.title);
            return;
        }
        
        const serviceChoiceEl = document.querySelector('input[name="rented"]:checked');
        if (!serviceChoiceEl) {
            showWarningModal('Please select a service (Washer, Dryer, or Both).');
            return;
        }
        const serviceChosen = serviceChoiceEl.value;
        
        // --- Validation Checks ---
        if ((serviceChosen === 'Washer' || serviceChosen === 'Both') && selectedWasherTime === 'Not Selected / Not Rented') {
            showWarningModal('Please pick a date & time slot for your Washer.');
            return;
        }
        if ((serviceChosen === 'Dryer' || serviceChosen === 'Both') && selectedDryerTime === 'Not Selected / Not Rented') {
            showWarningModal('Please pick a date & time slot for your Dryer.');
            return;
        }

        // --- Data Cleanup & Population for Review Screen ---
        const finalWasherTime = (serviceChosen === 'Dryer') ? 'N/A' : selectedWasherTime;
        const finalDryerTime = (serviceChosen === 'Washer') ? 'N/A' : selectedDryerTime;
        const priceDetails = getPriceDetails(serviceChosen);

        // Populate review screen with cleaned data
        document.getElementById('reviewGender').textContent = document.querySelector('input[name="gender"]:checked').value;
        document.getElementById('reviewName').textContent = document.getElementById('name').value;
        document.getElementById('reviewRoom').textContent = document.getElementById('roomNo').value;
        document.getElementById('reviewRented').textContent = serviceChosen;
        document.getElementById('reviewPrice').textContent = priceDetails.text;
        document.getElementById('reviewWasherTime').textContent = finalWasherTime;
        document.getElementById('reviewDryerTime').textContent = finalDryerTime;

        // Hide form and show payment/review screen
        document.getElementById('formScreen').classList.add('hidden');
        document.getElementById('paymentScreen').classList.remove('hidden');

        // Stop the inactivity timer on the review screen
        clearTimeout(inactivityTimer);
    });

    // Add event listener to the payment form to enable/disable the confirm button
    document.getElementById('paymentForm').addEventListener('input', validatePaymentForm);

    document.getElementById('backToFormBtn').addEventListener('click', function() {
        document.getElementById('paymentScreen').classList.add('hidden');
        document.getElementById('formScreen').classList.remove('hidden');
    });

    document.getElementById('paymentForm').addEventListener('submit', function(e) {
        e.preventDefault();

        const paymentMode = document.querySelector('input[name="paymentMode"]:checked');
        if (!paymentMode) {
            showWarningModal('Please select a payment method.');
            return;
        }

        const paymentModeValue = paymentMode.value;
        const cashInput = document.getElementById('paidToCash');
        const gcashInput = document.getElementById('paidToGcash');
        const referenceValue = paymentModeValue === 'Cash' ? cashInput.value.trim() : gcashInput.value.trim();

        if (paymentModeValue === 'Cash' && (!cashInput.value.trim() || !cashInput.checkValidity())) {
            showWarningModal('Please enter a valid receipt number in the format #N-NNNN.');
            return;
        }

        if (paymentModeValue === 'GCash' && !gcashInput.value.trim()) {
            showWarningModal('Please enter your GCash reference code.');
            return;
        }

        const btn = document.getElementById('submitBtn');
        btn.disabled = true;
        btn.innerText = "Checking reference...";
        showLoading('Checking your booking request...');

        checkReferenceDuplicate(referenceValue, function(isDuplicate) {
            if (isDuplicate === null) {
                hideLoading();
                showWarningModal('Could not verify the reference right now. Please try again.');
                btn.disabled = false;
                btn.innerText = "Confirm Booking";
                return;
            }

            if (isDuplicate) {
                hideLoading();
                showWarningModal('This receipt/reference number has already been used. Please enter a different one.');
                btn.disabled = false;
                btn.innerText = "Confirm Booking";
                return;
            }

            btn.innerText = "Transmitting to Sheets Tracker... ⏳";
            hideLoading();
            showLoading('Processing your booking...');

            // Store the form data in a global variable for the receipt
            // Reverted: This object now matches the order and fields expected by the old doPost function.
            const selectedService = document.querySelector('input[name="rented"]:checked').value;
            const priceDetails = getPriceDetails(selectedService);

            const formData = {
                gender: document.querySelector('input[name="gender"]:checked').value,
                name: document.getElementById('name').value,
                room_no: document.getElementById('roomNo').value,
                rented: selectedService,
                time_rented_dryer: (selectedService === 'Washer') ? 'N/A' : selectedDryerTime,
                time_rented_washer: (selectedService === 'Dryer') ? 'N/A' : selectedWasherTime,
                timestamp: new Date().toLocaleString('en-US', { timeZone: 'Asia/Manila' }), // Using a specific timezone
                paid_to: referenceValue,
                price_details: priceDetails.text
            };

            // Add the missing fields to lastBookingData for the receipt, even if not sent to the sheet.
            formData.payment_mode = paymentModeValue;

            lastBookingData = formData; // Save for email functionality

            postToScript({
                action: 'saveBooking',
                ...formData
            }).then(function(result) {
                if (result && result.success !== false) {
                    lastBookingData.transaction_no = result && result.transaction_no ? result.transaction_no : (lastBookingData.transaction_no || '—');
                    loadScheduleDataFromServer(true);
                    populateReceipt();
                    document.getElementById('paymentScreen').classList.add('hidden');
                    document.getElementById('receiptScreen').classList.remove('hidden');
                } else {
                    throw new Error(result && result.error ? result.error : 'Booking save failed');
                }
            }).catch(err => {
                hideLoading();
                showWarningModal(err && err.message ? err.message : "Something went wrong. Please check your connection and try again.");
                btn.disabled = false;
                btn.innerText = "Confirm Booking";
                console.error(err);
            }).finally(function() {
                hideLoading();
            });
        });
    });

    function populateReceipt() {
        const receiptBox = document.getElementById('receiptDetails');
        receiptBox.innerHTML = `
            <div class="summary-item"><strong>Transaction No:</strong> <span>${lastBookingData.transaction_no || '—'}</span></div>
            <div class="summary-item"><strong>Timestamp:</strong> <span>${lastBookingData.timestamp}</span></div>
            <div class="summary-item"><strong>Gender:</strong> <span>${lastBookingData.gender}</span></div>
            <div class="summary-item"><strong>Name:</strong> <span>${lastBookingData.name}</span></div>
            <div class="summary-item"><strong>Room Number:</strong> <span>${lastBookingData.room_no}</span></div>
            <div class="summary-item"><strong>Service Needed:</strong> <span>${lastBookingData.rented}</span></div>
            <div class="summary-item"><strong>Price:</strong> <span>${lastBookingData.price_details || 'Washer: ₱60 | Dryer: ₱60 | Total: ₱120'}</span></div>
            <div class="summary-item"><strong>Washer Slot:</strong> <span>${lastBookingData.time_rented_washer}</span></div>
            <div class="summary-item"><strong>Dryer Slot:</strong> <span>${lastBookingData.time_rented_dryer}</span></div>
            <div class="summary-item"><strong>Payment Mode:</strong> <span>${lastBookingData.payment_mode}</span></div>
            <div class="summary-item"><strong>Reference/Receipt No:</strong> <span>${lastBookingData.paid_to}</span></div>
        `;
    }

    // --- ADMIN PANEL SCRIPT ---

    let adminBookingsData = []; // To store the raw admin data for sorting
    let adminTimeSlotsData = getStoredTimeSlots();
    let currentAdminSort = { key: 'timestamp', direction: 'desc' };
    let editingSlotId = null;
    let isSavingSlot = false;
    function getSlotDisabledToggleValue() {
        const toggle = document.getElementById('slotDisabledToggle');
        return !!(toggle && toggle.checked);
    }
    function setSlotDisabledToggleValue(isDisabled) {
        const toggle = document.getElementById('slotDisabledToggle');
        if (toggle) toggle.checked = !!isDisabled;
    }
    let refreshTimer = null;
    let adminDataLoadInProgress = false;
    let columnPickerDragKey = null;

    function getDefaultAdminBookingColumns() {
        return ['done', 'timestamp', 'name', 'room_no', 'rented', 'time_rented_washer', 'time_rented_dryer', 'paid_to'];
    }

    function getAdminBookingColumnConfig() {
        return [
            { key: 'done', label: 'Status' },
            { key: 'transaction_no', label: 'Transaction No' },
            { key: 'timestamp', label: 'Timestamp' },
            { key: 'gender', label: 'Gender' },
            { key: 'name', label: 'Name' },
            { key: 'room_no', label: 'Room' },
            { key: 'rented', label: 'Service' },
            { key: 'time_rented_washer', label: 'Washer Slot' },
            { key: 'time_rented_dryer', label: 'Dryer Slot' },
            { key: 'payment_mode', label: 'Payment Mode' },
            { key: 'paid_to', label: 'Reference' }
        ];
    }

    function saveAdminBookingColumnPreferences(columns) {
        adminBookingColumnPreferences = columns;
        saveAdminSettings({ columnPreferences: JSON.stringify(columns) })
            .then(function(result) {
                if (!result || result.success === false) {
                    showWarningModal('Unable to sync column preferences. Changes are still applied locally in this session.');
                }
            });
    }

    function getVisibleAdminBookingColumns() {
        const validKeys = new Set(getAdminBookingColumnConfig().map(function(column) {
            return column.key;
        }));
        const selectedColumns = (adminBookingColumnPreferences || []).filter(function(key) {
            return validKeys.has(key);
        });
        return selectedColumns.length ? selectedColumns : getDefaultAdminBookingColumns();
    }

    function getColumnPickerDisplayOrder() {
        const visibleColumns = getVisibleAdminBookingColumns();
        const visibleSet = new Set(visibleColumns);
        const hiddenColumns = getAdminBookingColumnConfig()
            .map(function(column) {
                return column.key;
            })
            .filter(function(columnKey) {
                return !visibleSet.has(columnKey);
            });
        return [...visibleColumns, ...hiddenColumns];
    }

    function toggleColumnPickerItem(columnKey, isEnabled) {
        let nextColumns = [...adminBookingColumnPreferences];
        if (isEnabled) {
            if (!nextColumns.includes(columnKey)) {
                nextColumns.push(columnKey);
            }
        } else {
            nextColumns = nextColumns.filter(function(key) {
                return key !== columnKey;
            });
        }
        adminBookingColumnPreferences = nextColumns;
        renderColumnPickerOptions();
    }

    function reorderColumnPickerColumns(sourceColumnKey, targetColumnKey) {
        const currentColumns = [...adminBookingColumnPreferences];
        const sourceIndex = currentColumns.indexOf(sourceColumnKey);
        const targetIndex = currentColumns.indexOf(targetColumnKey);
        if (sourceIndex === -1 || targetIndex === -1) {
            return;
        }
        const [movedColumn] = currentColumns.splice(sourceIndex, 1);
        currentColumns.splice(targetIndex, 0, movedColumn);
        adminBookingColumnPreferences = currentColumns;
        renderColumnPickerOptions();
    }

    function renderColumnPickerOptions() {
        const container = document.getElementById('columnPickerOptions');
        const displayOrder = getColumnPickerDisplayOrder();
        const visibleColumns = new Set(getVisibleAdminBookingColumns());
        container.innerHTML = '';

        displayOrder.forEach(function(columnKey) {
            const columnConfig = getAdminBookingColumnConfig().find(function(column) {
                return column.key === columnKey;
            });
            if (!columnConfig) {
                return;
            }

            const item = document.createElement('div');
            const isActive = visibleColumns.has(columnKey);
            item.className = `column-picker-item${isActive ? '' : ' inactive'}`;
            item.draggable = isActive;
            item.dataset.columnKey = columnKey;
            item.innerHTML = `
                <div class="column-picker-label">
                    <span class="column-picker-handle" aria-hidden="true">⋮⋮</span>
                    <span>${columnConfig.label}</span>
                </div>
                <label class="column-picker-switch" title="${isActive ? 'Hide' : 'Show'} ${columnConfig.label}">
                    <input type="checkbox" ${isActive ? 'checked' : ''}>
                    <span></span>
                </label>
            `;

            const toggleInput = item.querySelector('input');
            toggleInput.addEventListener('change', function() {
                toggleColumnPickerItem(columnKey, this.checked);
            });

            item.addEventListener('dragstart', function(event) {
                if (!isActive) {
                    return;
                }
                columnPickerDragKey = columnKey;
                item.classList.add('dragging');
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', columnKey);
            });

            item.addEventListener('dragover', function(event) {
                if (!isActive || !columnPickerDragKey || columnPickerDragKey === columnKey) {
                    return;
                }
                event.preventDefault();
                item.classList.add('drag-over');
            });

            item.addEventListener('dragleave', function() {
                item.classList.remove('drag-over');
            });

            item.addEventListener('drop', function(event) {
                event.preventDefault();
                item.classList.remove('drag-over');
                if (!isActive || !columnPickerDragKey) {
                    return;
                }
                reorderColumnPickerColumns(columnPickerDragKey, columnKey);
                columnPickerDragKey = null;
            });

            item.addEventListener('dragend', function() {
                columnPickerDragKey = null;
                item.classList.remove('dragging');
                container.querySelectorAll('.column-picker-item').forEach(function(existingItem) {
                    existingItem.classList.remove('drag-over');
                });
            });

            container.appendChild(item);
        });
    }

    function openColumnPickerModal() {
        renderColumnPickerOptions();
        document.getElementById('columnPickerModal').classList.add('show');
    }

    function closeColumnPickerModal() {
        document.getElementById('columnPickerModal').classList.remove('show');
    }

    function refreshAdminData() {
        if (adminDataLoadInProgress) {
            return Promise.resolve();
        }
        adminDataLoadInProgress = true;
        return Promise.all([
            loadAdminData(),
            loadAdminSlots(),
            loadPricesFromServer()
        ]).finally(function() {
            adminDataLoadInProgress = false;
        });
    }

    function startAutoRefresh() {
        if (refreshTimer) {
            clearInterval(refreshTimer);
        }
        refreshTimer = null;
    }

    function showAdminLogin() { document.getElementById('adminLoginModal').classList.remove('hidden'); }
    function hideAdminLogin() { document.getElementById('adminLoginModal').classList.add('hidden'); }

    function completeAdminLogin(submitBtn) {
        hideAdminLogin();
        document.querySelector('.admin-icon').classList.add('hidden');
        document.querySelector('.container').classList.add('hidden');
        document.getElementById('adminPanel').classList.remove('hidden');
        updateBookingAvailabilityUI();
        refreshAdminData().finally(function() {
            submitBtn.disabled = false;
            submitBtn.innerHTML = 'Login';
        });
    }

    document.getElementById('adminLoginForm').addEventListener('submit', function(e) {
        e.preventDefault();
        const submitBtn = document.getElementById('adminLoginSubmitBtn');
        const user = document.getElementById('adminUser').value;
        const pass = document.getElementById('adminPass').value;

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="inline-spinner"></span>Signing in...';

        if (user === ADMIN_USERNAME && pass === 'adminconfig') {
            loadAdminPassword(function(storedPassword) {
                postToScript({
                    action: 'changeAdminPassword',
                    currentPassword: storedPassword,
                    newPassword: 'password123'
                }).then(function(result) {
                    if (result && result.success !== false) {
                        adminPassword = 'password123';
                        completeAdminLogin(submitBtn);
                    } else {
                        submitBtn.disabled = false;
                        submitBtn.innerHTML = 'Login';
                        showWarningModal('Could not reset admin password. Please try again.');
                    }
                }).catch(function() {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = 'Login';
                    showWarningModal('Could not reset admin password. Please try again.');
                });
            });
            return;
        }

        loadAdminPassword(function(storedPassword) {
            try {
                if (user === ADMIN_USERNAME && pass === storedPassword) {
                    completeAdminLogin(submitBtn);
                } else {
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = 'Login';
                    showWarningModal('Invalid credentials. Please try again.');
                }
            } catch (err) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = 'Login';
                showWarningModal('Could not sign in. Please try again.');
            }
        });
    });

    document.getElementById('maintenanceToggle').addEventListener('change', function() {
        toggleBookingAvailability('underMaintenance', this.checked);
    });

    document.getElementById('termBreakToggle').addEventListener('change', function() {
        toggleBookingAvailability('termBreak', this.checked);
    });

    document.getElementById('adminSettingsToggle').addEventListener('click', function() {
        const menu = document.getElementById('adminSettingsMenu');
        menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
    });

    document.addEventListener('click', function(e) {
        const menu = document.getElementById('adminSettingsMenu');
        const toggle = document.getElementById('adminSettingsToggle');
        if (menu && toggle && !menu.contains(e.target) && !toggle.contains(e.target)) {
            menu.style.display = 'none';
        }
    });

    function openAvailabilityModal() {
        updateBookingAvailabilityUI();
        document.getElementById('availabilityModal').classList.add('show');
    }

    function closeAvailabilityModal() {
        document.getElementById('availabilityModal').classList.remove('show');
    }

    document.getElementById('openAvailabilityModalBtn').addEventListener('click', function() {
        document.getElementById('adminSettingsMenu').style.display = 'none';
        openAvailabilityModal();
    });

    document.getElementById('closeAvailabilityModalBtn').addEventListener('click', closeAvailabilityModal);

    document.getElementById('openPasswordModalBtn').addEventListener('click', function() {
        document.getElementById('adminSettingsMenu').style.display = 'none';
        openPasswordModal();
    });

    document.getElementById('editTitleBtn').addEventListener('click', function() {
        document.getElementById('adminSettingsMenu').style.display = 'none';
        openTitleModal();
    });

    applyBookingAvailabilityState();

    function openTitleModal() {
        const titleInput = document.getElementById('mainTitleInput');
        const currentTitle = document.querySelector('h1.main-title') ? document.querySelector('h1.main-title').textContent.trim() : 'FTTMa Laundry Booking System';
        if (titleInput) {
            titleInput.value = currentTitle;
        }
        document.getElementById('titleModal').classList.add('show');
    }

    function closeTitleModal() {
        document.getElementById('titleModal').classList.remove('show');
    }

    document.getElementById('saveTitleBtn').addEventListener('click', function() {
        const titleInput = document.getElementById('mainTitleInput');
        if (!titleInput) return;
        const newTitle = titleInput.value.trim() || 'FTTMa Laundry Booking System';
        setMainPageTitle(newTitle);
        saveAdminSettings({ title: newTitle }).then(function(result) {
            if (!result || result.success === false) {
                showWarningModal('Unable to sync the main page title. The title was updated locally.');
            } else {
                showStatusToast('Main page title updated.', 'Updated');
            }
        }).catch(function() {
            showWarningModal('Unable to sync the main page title. The title was updated locally.');
        });
        closeTitleModal();
    });

    document.getElementById('closeTitleModalBtn').addEventListener('click', closeTitleModal);

    function setMainPageTitle(titleText) {
        const titleElement = document.querySelector('h1.main-title');
        if (titleElement) {
            titleElement.textContent = titleText;
        }
        document.title = titleText;
        adminMainPageTitle = titleText;
    }

    function loadMainPageTitle() {
        if (adminMainPageTitle) {
            setMainPageTitle(adminMainPageTitle);
        }
    }

    document.getElementById('changePasswordForm').addEventListener('submit', function(e) {
        e.preventDefault();

        const currentPassword = document.getElementById('currentAdminPass').value;
        const newPassword = document.getElementById('newAdminPass').value;
        const confirmPassword = document.getElementById('confirmAdminPass').value;

        if (!currentPassword || !newPassword || !confirmPassword) {
            showWarningModal('Please fill in all password fields.');
            return;
        }

        loadAdminPassword(function(storedPassword) {
            if (currentPassword !== storedPassword) {
                showWarningModal('Current password is incorrect.');
                return;
            }

            if (newPassword.length < 4) {
                showWarningModal('New password must be at least 4 characters long.');
                return;
            }

            if (newPassword !== confirmPassword) {
                showWarningModal('New password confirmation does not match.');
                return;
            }

            postToScript({
                action: 'changeAdminPassword',
                currentPassword: currentPassword,
                newPassword: newPassword
            }).then(function(result) {
                if (result && result.success !== false) {
                    adminPassword = newPassword;
                    closePasswordModal();
                    showWarningModal('Admin password updated successfully.', 'Success');
                } else {
                    throw new Error('Password change failed');
                }
            }).catch(() => {
                showWarningModal('Could not update password. Please try again.');
            });
        });
    });

    function loadAdminData(silent = false) {
        const tbody = document.getElementById('adminBookingsTable').querySelector('tbody');
        if (!tbody.dataset.initialized) {
            tbody.innerHTML = '<tr><td colspan="8">Loading bookings...</td></tr>';
        }

        return new Promise(function(resolve) {
            window.onAdminBookingsLoaded = function(data) {
                adminBookingsData = Array.isArray(data) ? data : [];
                existingBookingReferences = adminBookingsData;

                adminBookingsData.forEach(function(booking) {
                    booking.timestamp_date = new Date(booking.timestamp);
                    booking.done = Boolean(booking.done);
                });
                tbody.dataset.initialized = 'true';
                sortAndRenderAdminTable('desc');
                resolve(adminBookingsData);
            };

            const script = document.createElement('script');
            script.src = GOOGLE_SCRIPT_URL + "?action=getAdminData&callback=onAdminBookingsLoaded&t=" + Date.now();
            script.onerror = () => {
                if (!silent) {
                    tbody.innerHTML = '<tr><td colspan="7">Failed to load data.</td></tr>';
                }
                resolve([]);
            };
            script.onload = () => { document.body.removeChild(script); };
            document.body.appendChild(script);
        });
    }

    function loadAdminSlots(silent = false) {
        const tbody = document.getElementById('adminSlotsTable').querySelector('tbody');
        if (!tbody.dataset.initialized) {
            tbody.innerHTML = '<tr><td colspan="3">Loading slots...</td></tr>';
        }

        return new Promise(function(resolve) {
            window.onAdminSlotsLoaded = function(data) {
                const remoteSlots = (data && data.timeSlots) ? data.timeSlots : [];
                adminTimeSlotsData = mergeTimeSlots(remoteSlots);
                tbody.dataset.initialized = 'true';
                renderAdminSlots();
                populateSlotSelect();
                resolve(adminTimeSlotsData);
            };

            const script = document.createElement('script');
            script.src = GOOGLE_SCRIPT_URL + "?action=getTimeSlots&callback=onAdminSlotsLoaded&t=" + Date.now();
            script.onerror = () => {
                if (!silent) {
                    tbody.innerHTML = '<tr><td colspan="3">Failed to load slots.</td></tr>';
                }
                resolve([]);
            };
            script.onload = () => { document.body.removeChild(script); };
            document.body.appendChild(script);
        });
    }

    function normalizeSlotDateValue(value) {
        const parsed = parseSlotDateValue(value);
        if (!parsed) return '';
        const year = parsed.getFullYear();
        const month = String(parsed.getMonth() + 1).padStart(2, '0');
        const day = String(parsed.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function isUpcomingSlot(slot) {
        if (!slot) return false;
        const visibleDays = getSlotVisibleDays(slot);
        if (visibleDays.length) return true;
        if (!slot.slot_date) return false;
        const slotDate = new Date(normalizeSlotDateValue(slot.slot_date) + 'T00:00:00');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return slotDate >= today;
    }

    function isWeekendDate(dateValue, weekendType) {
        const normalizedDate = normalizeSlotDateValue(dateValue);
        const parsedDate = new Date(normalizedDate + 'T00:00:00');
        if (Number.isNaN(parsedDate.getTime())) return false;
        const day = parsedDate.getDay();
        return weekendType === 'sunday' ? day === 0 : day === 6;
    }

    function getSelectedVisibleDays() {
        const dayButtons = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        return dayButtons.filter(day => document.getElementById(day + 'Btn').classList.contains('active'));
    }

    function getUpcomingWeekdayDate(dayName) {
        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const dayIndexMap = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
        const targetDay = dayIndexMap[dayName] ?? 1;
        const currentDay = start.getDay();
        let daysUntil = (targetDay - currentDay + 7) % 7;
        if (daysUntil === 0) {
            daysUntil = 7;
        }
        const result = new Date(start);
        result.setDate(start.getDate() + daysUntil);
        const year = result.getFullYear();
        const month = String(result.getMonth() + 1).padStart(2, '0');
        const day = String(result.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function setVisibleDaysSelection(valueList) {
        const dayButtons = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        dayButtons.forEach(day => document.getElementById(day + 'Btn').classList.toggle('active', valueList.includes(day)));

        const slotDateInput = document.getElementById('slotDate');
        const slotSelect = document.getElementById('slotSelect');
        if (valueList.length > 0) {
            slotDateInput.value = '';
            slotDateInput.disabled = true;
            slotSelect.disabled = true;
        } else {
            slotDateInput.disabled = false;
            slotSelect.disabled = false;
            if (!slotDateInput.value) {
                slotDateInput.value = '';
            }
        }
    }

    function isVisibleSlot(slot) {
        if (!isUpcomingSlot(slot)) return false;
        const selectedDays = getSelectedVisibleDays();
        if (!selectedDays.length) return true;
        const visibleDays = getSlotVisibleDays(slot);
        if (!visibleDays.length) return true;
        return selectedDays.some(day => visibleDays.includes(day));
    }

    function renderAdminSlots() {
        const tbody = document.getElementById('adminSlotsTable').querySelector('tbody');
        const visibleSlots = (adminTimeSlotsData || []).filter(isVisibleSlot);
        tbody.innerHTML = '';
        if (!visibleSlots.length) {
            tbody.innerHTML = '<tr><td colspan="2">No available slots configured.</td></tr>';
            return;
        }

        visibleSlots.forEach(slot => {
            const row = tbody.insertRow();
            const dayLabel = getSlotDayLabel(slot);
            const dateCellValue = slot.slot_date ? slot.slot_date : (dayLabel ? 'Recurring' : '—');
            row.innerHTML = `
                <td>${dateCellValue}</td>
                <td>${slot.slot_time || '—'}${dayLabel ? `<div style="font-size:12px;color:#64748b;">${dayLabel}</div>` : ''}</td>
            `;
        });
    }

    function populateSlotSelect() {
        const slotSelect = document.getElementById('slotSelect');
        slotSelect.innerHTML = '<option value="">Add a new slot</option>';
        (adminTimeSlotsData || []).filter(isVisibleSlot).forEach(slot => {
            const option = document.createElement('option');
            option.value = slot.id;
            const dayLabel = getSlotDayLabel(slot);
            const displayDate = slot.slot_date || (dayLabel ? 'Recurring' : '—');
            option.textContent = `${displayDate} • ${slot.slot_time || '—'}`;
            slotSelect.appendChild(option);
        });
    }

    function setSlotActionBusy(isBusy) {
        const buttons = [
            document.getElementById('saveSlotBtn'),
            document.getElementById('updateSlotBtn'),
            document.getElementById('deleteSlotBtn'),
            document.getElementById('cancelSlotEditBtn')
        ];
        buttons.forEach(btn => {
            if (btn) btn.disabled = isBusy;
        });
    }

    function openSlotModal() {
        populateSlotSelect();
        document.getElementById('slotModal').classList.add('show');
        document.getElementById('slotDate').value = '';
        document.getElementById('slotTime').value = '';
        document.getElementById('slotSelect').value = '';
        setVisibleDaysSelection([]);
        document.getElementById('saveSlotBtn').classList.remove('hidden');
        document.getElementById('updateSlotBtn').classList.add('hidden');
        document.getElementById('deleteSlotBtn').classList.add('hidden');
        editingSlotId = null;
        setSlotDisabledToggleValue(false);
    }

    function closeSlotModal() {
        document.getElementById('slotModal').classList.remove('show');
        document.getElementById('slotDate').value = '';
        document.getElementById('slotTime').value = '';
        document.getElementById('slotSelect').value = '';
        setVisibleDaysSelection([]);
        document.getElementById('saveSlotBtn').classList.remove('hidden');
        document.getElementById('updateSlotBtn').classList.add('hidden');
        document.getElementById('deleteSlotBtn').classList.add('hidden');
        editingSlotId = null;
        setSlotDisabledToggleValue(false);
    }

    function startEditSlot(id, slotDate, slotTime, slotVisibleDaysValue, slotWeekendType, slotStatus) {
        editingSlotId = id;
        document.getElementById('slotSelect').value = id;
        document.getElementById('slotTime').value = slotTime || '';
        document.getElementById('slotModal').classList.add('show');
        document.getElementById('saveSlotBtn').classList.add('hidden');
        document.getElementById('updateSlotBtn').classList.remove('hidden');
        document.getElementById('deleteSlotBtn').classList.remove('hidden');

        setSlotDisabledToggleValue(String(slotStatus || '').toLowerCase() === 'inactive');

        const visibleDays = getSlotVisibleDays({ slot_visible_days: slotVisibleDaysValue || slotWeekendType || '' });
        if (visibleDays.length) {
            setVisibleDaysSelection(visibleDays);
            document.getElementById('slotDate').value = '';
        } else {
            setVisibleDaysSelection([]);
            document.getElementById('slotDate').value = slotDate || '';
        }
    }

    function saveTimeSlot() {
        if (isSavingSlot) return;
        const slotDateInput = document.getElementById('slotDate');
        const slotTime = document.getElementById('slotTime').value;
        const visibleDays = getSelectedVisibleDays();
        const slotDate = slotDateInput.value || '';
        if (!slotTime) {
            showWarningModal('Please fill in the slot time.');
            return;
        }
        if (!visibleDays.length && !slotDate) {
            showWarningModal('Please choose a date or at least one day.');
            return;
        }

        isSavingSlot = true;
        setSlotActionBusy(true);
        slotDateInput.value = slotDate;

        const newSlotId = String(Date.now());
        const isDisabled = getSlotDisabledToggleValue();
        const newSlot = {
            id: newSlotId,
            slot_date: slotDate,
            slot_time: slotTime,
            slot_visible_days: visibleDays.join(','),
            slot_weekend_type: '',
            status: isDisabled ? 'inactive' : 'active'
        };
        adminTimeSlotsData = [...adminTimeSlotsData, newSlot];
        renderAdminSlots();
        populateSlotSelect();
        refreshBookingSchedule();

        postToScript({
            action: 'manageTimeSlots',
            mode: 'add',
            slotId: newSlotId,
            slotDate: slotDate,
            slotTime: slotTime,
            slotVisibleDays: visibleDays.join(','),
            slotDisabled: getSlotDisabledToggleValue()
        }).then(function(result) {
            if (result && result.success !== false) {
                closeSlotModal();
                return Promise.all([
                    loadAdminSlots(),
                    loadScheduleDataFromServer(true)
                ]).then(function() {
                    showWarningModal('Future slot added successfully.', 'Success');
                });
            }
            throw new Error('Slot add failed');
        }).catch(() => {
            closeSlotModal();
            showWarningModal('Slot saved locally, but the sync to Apps Script did not complete.');
        }).finally(() => {
            isSavingSlot = false;
            setSlotActionBusy(false);
        });
    }

    function updateTimeSlot() {
        if (!editingSlotId || isSavingSlot) return;
        const slotDateInput = document.getElementById('slotDate');
        const slotTime = document.getElementById('slotTime').value;
        const visibleDays = getSelectedVisibleDays();
        const slotDate = slotDateInput.value || '';
        if (!slotTime) {
            showWarningModal('Please fill in the slot time.');
            return;
        }
        if (!visibleDays.length && !slotDate) {
            showWarningModal('Please choose a date or at least one day.');
            return;
        }

        isSavingSlot = true;
        setSlotActionBusy(true);
        slotDateInput.value = slotDate;

        const isDisabled = getSlotDisabledToggleValue();
        adminTimeSlotsData = adminTimeSlotsData.map(slot => {
            if (String(slot.id) === String(editingSlotId)) {
                return { ...slot, slot_date: slotDate, slot_time: slotTime, slot_visible_days: visibleDays.join(','), slot_weekend_type: '', status: isDisabled ? 'inactive' : 'active' };
            }
            return slot;
        });
        renderAdminSlots();
        populateSlotSelect();
        refreshBookingSchedule();

        postToScript({
            action: 'manageTimeSlots',
            mode: 'edit',
            slotId: editingSlotId,
            slotDate: slotDate,
            slotTime: slotTime,
            slotVisibleDays: visibleDays.join(','),
            slotDisabled: getSlotDisabledToggleValue()
        }).then(function(result) {
            if (result && result.success !== false) {
                closeSlotModal();
                return Promise.all([
                    loadAdminSlots(),
                    loadScheduleDataFromServer(true)
                ]).then(function() {
                    showWarningModal('Future slot updated successfully.', 'Success');
                });
            }
            throw new Error('Slot edit failed');
        }).catch(() => {
            closeSlotModal();
            showWarningModal('Slot updated locally, but the sync to Apps Script did not complete.');
        }).finally(() => {
            isSavingSlot = false;
            setSlotActionBusy(false);
        });
    }

    function deleteSlot(slotId) {
        if (!slotId || isSavingSlot) return;
        isSavingSlot = true;
        setSlotActionBusy(true);

        const previousSlots = adminTimeSlotsData;
        adminTimeSlotsData = adminTimeSlotsData.filter(slot => String(slot.id) !== String(slotId));
        renderAdminSlots();
        populateSlotSelect();
        refreshBookingSchedule();

        postToScript({
            action: 'manageTimeSlots',
            mode: 'delete',
            slotId: slotId
        }).then(function(result) {
            if (result && result.success !== false) {
                closeSlotModal();
                return Promise.all([
                    loadAdminSlots(),
                    loadScheduleDataFromServer(true)
                ]).then(function() {
                    showWarningModal('Future slot deleted successfully.', 'Success');
                });
            }
            adminTimeSlotsData = previousSlots;
            renderAdminSlots();
            populateSlotSelect();
            refreshBookingSchedule();
            throw new Error('Slot delete failed');
        }).catch(() => {
            adminTimeSlotsData = previousSlots;
            renderAdminSlots();
            populateSlotSelect();
            refreshBookingSchedule();
            closeSlotModal();
            showWarningModal('Slot could not be deleted. Please try again.');
        }).finally(function() {
            isSavingSlot = false;
            setSlotActionBusy(false);
            hideLoading();
        });
    }

    function refreshBookingSchedule() {
        buildSchedule('washerTable', 'washerSlot');
        buildSchedule('dryerTable', 'dryerSlot');
    }

    function applyFiltersAndRender() {
        let filteredData = [...adminBookingsData];
        const searchTerm = document.getElementById('adminSearch').value.toLowerCase();
        const startDate = document.getElementById('startDate').valueAsDate;
        const endDate = document.getElementById('endDate').valueAsDate;

        // Apply search and date filters
        if (searchTerm) {
            filteredData = filteredData.filter(booking => Object.values(booking).join(' ').toLowerCase().includes(searchTerm));
        }
        if (startDate) {
            filteredData = filteredData.filter(booking => booking.timestamp_date >= startDate);
        }
        if (endDate) {
            // Add 1 day to the end date to make the filter inclusive
            const inclusiveEndDate = new Date(endDate.getTime() + (24 * 60 * 60 * 1000));
            filteredData = filteredData.filter(booking => booking.timestamp_date < inclusiveEndDate);
        }

        renderAdminSummaryMetrics(filteredData);
        renderAdminTable(filteredData);
    }

    function renderAdminSummaryMetrics(data) {
        const total = data.length;
        const done = data.filter(function(booking) {
            return Boolean(booking.done);
        }).length;
        const pending = total - done;
        const startDate = document.getElementById('startDate').value;
        const endDate = document.getElementById('endDate').value;
        const rangeText = startDate || endDate ? `${startDate || 'Any'} → ${endDate || 'Any'}` : 'All bookings';

        const totalEl = document.getElementById('adminSummaryTotal');
        const doneEl = document.getElementById('adminSummaryDone');
        const pendingEl = document.getElementById('adminSummaryPending');
        const rangeEl = document.getElementById('adminSummaryRange');

        if (totalEl) totalEl.textContent = String(total);
        if (doneEl) doneEl.textContent = String(done);
        if (pendingEl) pendingEl.textContent = String(pending);
        if (rangeEl) rangeEl.textContent = rangeText;
    }

    function updateBookingDoneStatus(rowNumber, isDone) {
        return postToScript({
            action: 'updateBookingStatus',
            rowNumber: rowNumber,
            done: String(isDone)
        }).then(function(result) {
            if (result && result.success !== false) {
                const targetBooking = adminBookingsData.find(function(booking) {
                    return String(booking.sheet_row) === String(rowNumber);
                });
                if (targetBooking) {
                    targetBooking.done = isDone;
                }
                applyFiltersAndRender();
                return true;
            }
            throw new Error('Unable to update booking status');
        }).catch(function(error) {
            console.error(error);
            showWarningModal('Could not update the booking status. Please try again.');
            return false;
        });
    }

    function getAdminSortIconSvg(direction) {
        const isAsc = direction === 'asc';
        const path = isAsc
            ? 'M3.5 12.5a.5.5 0 0 1-1 0V3.707L1.354 4.854a.5.5 0 1 1-.708-.708l2-1.999.007-.007a.5.5 0 0 1 .7.006l2 2a.5.5 0 1 1-.707.708L3.5 3.707zm3.5-9a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5M7.5 6a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1zm0 3a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1zm0 3a.5.5 0 0 0 0 1h1a.5.5 0 0 0 0-1z'
            : 'M3.5 2.5a.5.5 0 0 0-1 0v8.793l-1.146-1.147a.5.5 0 0 0-.708.708l2 1.999.007.007a.497.497 0 0 0 .7-.006l2-2a.5.5 0 0 0-.707-.708L3.5 11.293zm3.5 1a.5.5 0 0 1 .5-.5h7a.5.5 0 0 1 0 1h-7a.5.5 0 0 1-.5-.5M7.5 6a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1zm0 3a.5.5 0 0 0 0 1h3a.5.5 0 0 0 0-1zm0 3a.5.5 0 0 0 0 1h1a.5.5 0 0 0 0-1z';
        return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="admin-sort-icon" viewBox="0 0 16 16"><path d="${path}"/></svg>`;
    }

    function getAdminSortValue(booking, columnKey) {
        if (columnKey === 'timestamp') {
            return booking.timestamp_date instanceof Date ? booking.timestamp_date.getTime() : (Date.parse(booking.timestamp || '') || 0);
        }

        if (columnKey === 'time_rented_washer' || columnKey === 'time_rented_dryer') {
            const rawValue = String(booking[columnKey] || '').trim();
            if (!rawValue || rawValue === '—') {
                return '';
            }
            return rawValue.toLowerCase();
        }

        return String(booking[columnKey] || '').trim().toLowerCase();
    }

    function compareAdminBookingValues(a, b, columnKey) {
        const aValue = getAdminSortValue(a, columnKey);
        const bValue = getAdminSortValue(b, columnKey);

        if (columnKey === 'timestamp') {
            if (aValue === bValue) return 0;
            return aValue > bValue ? 1 : -1;
        }

        if (!aValue && !bValue) return 0;
        if (!aValue) return 1;
        if (!bValue) return -1;

        return aValue.localeCompare(bValue, undefined, { numeric: true, sensitivity: 'base' });
    }

    function renderAdminTable(data) {
        const table = document.getElementById('adminBookingsTable');
        const tbody = table.querySelector('tbody');
        const visibleColumns = getVisibleAdminBookingColumns();
        const thead = table.querySelector('thead');
        thead.innerHTML = '';
        const headerRow = document.createElement('tr');

        visibleColumns.forEach(function(columnKey) {
            const columnConfig = getAdminBookingColumnConfig().find(function(column) {
                return column.key === columnKey;
            }) || { key: columnKey, label: columnKey };
            const headerCell = document.createElement('th');
            const isSortable = ['timestamp', 'time_rented_washer', 'time_rented_dryer'].includes(columnKey);
            const isActive = isSortable && currentAdminSort.key === columnKey;
            const sortDirection = isActive ? currentAdminSort.direction : 'desc';
            headerCell.dataset.column = columnKey;
            headerCell.dataset.sortable = isSortable ? 'true' : 'false';
            headerCell.classList.toggle('sortable', isSortable);
            headerCell.style.cursor = isSortable ? 'pointer' : 'default';
            headerCell.innerHTML = `
                <span class="admin-header-content">
                    <span class="admin-header-label">${columnConfig.label}</span>
                    ${isSortable ? `<span class="admin-sort-icon-wrap${isActive ? ' active' : ''}">${getAdminSortIconSvg(sortDirection)}</span>` : ''}
                </span>`;
            headerRow.appendChild(headerCell);
        });
        thead.appendChild(headerRow);

        tbody.innerHTML = '';
        if (!data || data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="${Math.max(1, visibleColumns.length)}">No bookings found.</td></tr>`;
            return;
        }

        const columnLabels = visibleColumns.map(function(columnKey) {
            const columnConfig = getAdminBookingColumnConfig().find(function(column) {
                return column.key === columnKey;
            }) || { key: columnKey, label: columnKey };
            return columnConfig.label;
        });

        data.forEach(function(booking) {
            const row = tbody.insertRow();
            const isDone = Boolean(booking.done);
            row.className = isDone ? 'booking-done-row' : '';
            const cells = visibleColumns.map(function(columnKey) {
                if (columnKey === 'done') {
                    return `
                        <td>
                            <div class="booking-status-cell">
                                <label class="booking-status-toggle" title="Toggle completed status">
                                    <input type="checkbox" ${isDone ? 'checked' : ''} data-row-number="${booking.sheet_row || ''}">
                                    <span class="booking-status-slider"></span>
                                </label>
                            </div>
                        </td>`;
                }

                if (columnKey === 'transaction_no') {
                    return `<td>${booking.transaction_no || '—'}</td>`;
                }
                if (columnKey === 'timestamp') {
                    return `<td>${booking.timestamp || '—'}</td>`;
                }
                if (columnKey === 'gender') {
                    return `<td>${booking.gender || '—'}</td>`;
                }
                if (columnKey === 'name') {
                    return `<td>${booking.name || '—'}</td>`;
                }
                if (columnKey === 'room_no') {
                    return `<td>${booking.room_no || '—'}</td>`;
                }
                if (columnKey === 'rented') {
                    return `<td>${booking.rented || '—'}</td>`;
                }
                if (columnKey === 'time_rented_washer') {
                    return `<td>${booking.time_rented_washer || '—'}</td>`;
                }
                if (columnKey === 'time_rented_dryer') {
                    return `<td>${booking.time_rented_dryer || '—'}</td>`;
                }
                if (columnKey === 'payment_mode') {
                    return `<td>${booking.payment_mode || '—'}</td>`;
                }
                if (columnKey === 'paid_to') {
                    return `<td>${booking.paid_to || '—'}</td>`;
                }
                return `<td>${booking[columnKey] || '—'}</td>`;
            }).join('');

            row.innerHTML = cells;
            Array.from(row.children).forEach(function(cell, index) {
                cell.setAttribute('data-label', columnLabels[index] || '');
            });
            const toggleInput = row.querySelector('input[type="checkbox"]');
            if (toggleInput) {
                toggleInput.addEventListener('change', function() {
                    updateBookingDoneStatus(this.dataset.rowNumber, this.checked);
                });
            }
        });
    }

    function sortAndRenderAdminTable(columnKey, direction) {
        if (!['timestamp', 'time_rented_washer', 'time_rented_dryer'].includes(columnKey)) {
            columnKey = currentAdminSort.key;
        }

        const nextDirection = direction || (currentAdminSort.key === columnKey && currentAdminSort.direction === 'asc' ? 'desc' : 'asc');
        currentAdminSort = { key: columnKey, direction: nextDirection };

        adminBookingsData.sort((a, b) => {
            const comparison = compareAdminBookingValues(a, b, columnKey);
            return currentAdminSort.direction === 'asc' ? comparison : -comparison;
        });

        applyFiltersAndRender();
    }

    function exportAdminBookingsCsv() {
        const table = document.getElementById('adminBookingsTable');
        const headers = Array.from(table.querySelectorAll('thead th')).map(function(th) {
            return '"' + th.textContent.trim().replace(/"/g, '""') + '"';
        });
        const rows = Array.from(table.querySelectorAll('tbody tr'))
            .filter(function(row) {
                return row.querySelectorAll('td').length > 0;
            })
            .map(function(row) {
                return Array.from(row.querySelectorAll('td')).map(function(cell) {
                    const checkbox = cell.querySelector('input[type="checkbox"]');
                    let cellValue = checkbox ? (checkbox.checked ? 'Done' : 'Pending') : cell.textContent.trim();
                    cellValue = cellValue.replace(/"/g, '""');
                    return '"' + cellValue + '"';
                }).join(',');
            });

        if (!rows.length) {
            showWarningModal('There is no booking data to export.', 'Export Empty');
            return;
        }

        const csvContent = [headers.join(','), ...rows].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.setAttribute('download', 'bookings_export.csv');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    document.getElementById('adminBookingsTable').addEventListener('click', function(event) {
        const header = event.target.closest('th[data-column]');
        if (!header || header.dataset.sortable !== 'true') {
            return;
        }
        const columnKey = header.dataset.column;
        const isSameColumn = currentAdminSort.key === columnKey;
        const nextDirection = isSameColumn && currentAdminSort.direction === 'asc' ? 'desc' : 'asc';
        sortAndRenderAdminTable(columnKey, nextDirection);
    });

    function debounce(fn, delay) {
        let timeoutId;
        return function() {
            const context = this;
            const args = arguments;
            clearTimeout(timeoutId);
            timeoutId = setTimeout(function() {
                fn.apply(context, args);
            }, delay);
        };
    }

    document.getElementById('adminSearch').addEventListener('input', debounce(applyFiltersAndRender, 250));
    document.getElementById('startDate').addEventListener('change', applyFiltersAndRender);
    document.getElementById('endDate').addEventListener('change', applyFiltersAndRender);

    document.getElementById('resetBtn').addEventListener('click', function() {
        document.getElementById('adminSearch').value = '';
        document.getElementById('startDate').value = '';
        document.getElementById('endDate').value = '';
        applyFiltersAndRender();
    });

    document.getElementById('exportCsvBtn').addEventListener('click', function() {
        exportAdminBookingsCsv();
    });

    document.getElementById('customizeColumnsBtn').addEventListener('click', openColumnPickerModal);
    document.getElementById('closeColumnPickerBtn').addEventListener('click', closeColumnPickerModal);
    document.getElementById('saveColumnPrefsBtn').addEventListener('click', function() {
        const selectedColumns = [...adminBookingColumnPreferences];

        if (!selectedColumns.length) {
            showWarningModal('Please keep at least one column visible.');
            return;
        }

        saveAdminBookingColumnPreferences(selectedColumns);
        closeColumnPickerModal();
        applyFiltersAndRender();
    });

    document.getElementById('downloadPdfBtn').addEventListener('click', function() {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({
            orientation: 'landscape'
        });

        doc.text("FTTMa Bookings Report", 14, 15);

        doc.autoTable({
            html: '#adminBookingsTable',
            startY: 20,
            headStyles: { fillColor: [52, 152, 219] }, // Blue header to match theme
            didParseCell: function (data) {
                // Clean up header text from sort icons before printing
                if (data.section === 'head') {
                    data.cell.text = data.cell.text[0].replace(' 🔽','').replace(' 🔼','');
                }
            }
        });

        doc.save('bookings_export.pdf');
    });

    document.getElementById('openSlotModalBtn').addEventListener('click', openSlotModal);
    document.getElementById('saveSlotBtn').addEventListener('click', function() {
        saveTimeSlot();
    });
    document.getElementById('updateSlotBtn').addEventListener('click', function() {
        updateTimeSlot();
    });
    document.getElementById('deleteSlotBtn').addEventListener('click', function() {
        if (editingSlotId) {
            deleteSlot(editingSlotId);
        }
    });
    ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].forEach(day => {
        document.getElementById(day + 'Btn').addEventListener('click', function() {
            const selectedDays = getSelectedVisibleDays();
            const nextDays = selectedDays.includes(day)
                ? selectedDays.filter(item => item !== day)
                : [...selectedDays, day];
            setVisibleDaysSelection(nextDays);
            renderAdminSlots();
            populateSlotSelect();
        });
    });
    document.getElementById('cancelSlotEditBtn').addEventListener('click', closeSlotModal);
    document.getElementById('slotSelect').addEventListener('change', function() {
        const selectedId = this.value;
        if (!selectedId) {
            document.getElementById('slotDate').value = '';
            document.getElementById('slotTime').value = '';
            document.getElementById('saveSlotBtn').classList.remove('hidden');
            document.getElementById('updateSlotBtn').classList.add('hidden');
            document.getElementById('deleteSlotBtn').classList.add('hidden');
            editingSlotId = null;
            return;
        }

        const selectedSlot = (adminTimeSlotsData || []).find(slot => String(slot.id) === String(selectedId));
        if (selectedSlot) {
            startEditSlot(selectedSlot.id, selectedSlot.slot_date, selectedSlot.slot_time, selectedSlot.slot_visible_days, selectedSlot.slot_weekend_type, selectedSlot.status);
        }
    });
    window.startEditSlot = startEditSlot;
    window.deleteSlot = deleteSlot;
    window.openSlotModal = openSlotModal;
    window.closeSlotModal = closeSlotModal;

    document.getElementById('adminLogoutBtn').addEventListener('click', function() {
        document.getElementById('adminPanel').classList.add('hidden');
        document.querySelector('.admin-icon').classList.remove('hidden');
        document.querySelector('.container').classList.remove('hidden');
        document.getElementById('adminLoginForm').reset();
        window.location.reload();
    });

