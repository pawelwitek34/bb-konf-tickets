/* Camp 2.0 pricing widget — external JavaScript test build.
 * Source split from Cennik-camp2.html to avoid inline-script corruption
 * in the Landingi -> WordPress import pipeline.
 */

(function() {
    'use strict';

    var DEBUG_MODE = false;
    var CONFIG_URL = 'https://raw.githubusercontent.com/pawelwitek34/bb-konf-tickets/refs/heads/main/camp2-cennik.json';
    var SECTION_ORDER = ['solo', 'duo'];
    var SECTION_CONFIG = {
        solo: {
            title: 'Dla 1 osoby',
            cardVariantTitle: 'Dla 1 osoby',
            roomLabel: 'Miejsce w pokoju 2-osobowym',
            roomNote: 'Podział na pokoje męskie i żeńskie'
        },
        duo: {
            title: 'Dla 2 osób',
            cardVariantTitle: 'Dla 2 osób',
            roomLabel: 'Pokój 2-osobowy',
            noteTitle: 'PRZY ZAKUPIE 2 MIEJSC - TANIEJ O 300 ZŁ',
            noteText: 'Niezależnie od tego, czy jedziecie jako para, czy przyjeżdżacie we dwie przyjaciółki.'
        }
    };
    var COUNTDOWN_MONTH_NAMES = [
        'stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
        'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'
    ];

    var countdownTargetDate = null;
    var pricingModel = null;
    var pricingSelection = {
        variant: null
    };
    var activeStepAnimation = null;

    function reserveLandingiHeight(widget, duration) {
        if (!widget) return;
        var finalHeight = Math.ceil(Math.max(widget.offsetHeight, widget.scrollHeight));
        if (!finalHeight) return;

        document.dispatchEvent(new CustomEvent('camp2:reserve-height', {
            detail: {
                widgetHeight: finalHeight,
                duration: duration || 700
            }
        }));
    }

    function debugLog(message, data) {
        if (!DEBUG_MODE) return;
        if (data !== undefined) {
            console.log('[CAMP2-WIDGET] ' + message, data);
        } else {
            console.log('[CAMP2-WIDGET] ' + message);
        }
    }

    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function toNumberOrNull(value) {
        if (value === null || value === undefined || value === '') return null;
        var parsed = Number(value);
        return isFinite(parsed) ? parsed : null;
    }

    function formatMoney(value) {
        var number = toNumberOrNull(value);
        if (number === null) return escapeHtml(value || '');
        if (Math.round(number) === number) return String(number);
        return number.toLocaleString('pl-PL', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    function getPaymentTitle(offer, isInstallments) {
        if (!isInstallments) return (offer && offer.displayName) || 'Płatność jednorazowa';
        var count = offer ? toNumberOrNull(offer.installmentsCount) : null;
        count = count || 3;
        return count === 1 ? 'Płatność w 1 racie' : 'Płatność w ' + count + ' ratach';
    }

    function renderRoomDescription(sectionContent) {
        var noteMarkup = sectionContent.roomNote
            ? '<span class="cpw-room-note">' + escapeHtml(sectionContent.roomNote) + '</span>'
            : '';
        return '<p class="cpw-card-desc">' + escapeHtml(sectionContent.roomLabel) + noteMarkup + '</p>';
    }

    function getFutureInstallmentSchedule(installmentsCount) {
        var futurePayments = Math.max(0, installmentsCount - 1);
        if (futurePayments === 0) return '';
        if (futurePayments === 1) return 'za 1 miesiąc';

        var labels = [];
        for (var i = 1; i <= futurePayments; i++) labels.push('za ' + i);
        return labels.slice(0, -1).join(', ') + ' oraz ' + labels[labels.length - 1] + ' miesiące';
    }

    function renderPaymentSummary(isInstallments, salePrice, installmentsCount, totalCost, regularPrice) {
        if (!isInstallments) {
            var deadlineLabel = getPriceDeadlineLabel();
            var nextPrice = toNumberOrNull(regularPrice);
            return deadlineLabel
                ? '<div class="cpw-payment-summary">' + escapeHtml(deadlineLabel)
                    + (nextPrice !== null ? ' do kwoty ' + formatMoney(nextPrice) + ' zł' : '')
                    + '</div>'
                : '';
        }

        var schedule = getFutureInstallmentSchedule(installmentsCount);
        return '<div class="cpw-payment-summary">Pierwszą płatność pobierzemy <strong>dzisiaj</strong> w kwocie '
            + formatMoney(salePrice) + ' zł. '
            + (schedule ? 'Kolejne płatności: ' + escapeHtml(schedule) + '. ' : '')
            + 'Łączna kwota: ' + formatMoney(totalCost) + ' zł.</div>';
    }

    function parseEndDate(dateStr) {
        if (!dateStr) return null;
        return new Date(dateStr.replace(' ', 'T'));
    }

    function getCountdownTargetDate() {
        return countdownTargetDate;
    }

    function getPriceDeadlineLabel() {
        var targetDate = getCountdownTargetDate();
        if (!targetDate) return '';
        var day = targetDate.getDate();
        var monthName = COUNTDOWN_MONTH_NAMES[targetDate.getMonth()];
        return 'Cena wzrośnie po ' + day + ' ' + monthName;
    }

    function fetchConfig() {
        var timestamp = new Date().getTime();
        var urlWithTimestamp = CONFIG_URL + '?v=' + timestamp;
        debugLog('Pobieranie konfiguracji z: ' + urlWithTimestamp);

        return fetch(urlWithTimestamp)
            .then(function(response) {
                if (!response.ok) throw new Error('Błąd pobierania: ' + response.status);
                return response.json();
            })
            .then(function(data) {
                debugLog('Pobrano konfigurację:', data);
                return data;
            })
            .catch(function(error) {
                debugLog('BŁĄD pobierania konfiguracji:', error);
                return null;
            });
    }

    function buildOfferMatrix(pricing) {
        var matrix = {
            solo: { jednorazowo: null, raty: null },
            duo: { jednorazowo: null, raty: null }
        };

        for (var i = 0; i < pricing.length; i++) {
            var offer = pricing[i];
            var variant = offer.tierVariant;
            var payment = offer.tierType === 'RATY'
                ? 'raty'
                : (offer.tierType === 'JEDNORAZOWO' ? 'jednorazowo' : null);

            if (matrix[variant] && payment) matrix[variant][payment] = offer;
        }

        return matrix;
    }

    function chooseInitialSelection(matrix) {
        var fallbackOrder = [
            ['solo', 'jednorazowo'],
            ['solo', 'raty'],
            ['duo', 'jednorazowo'],
            ['duo', 'raty']
        ];

        for (var i = 0; i < fallbackOrder.length; i++) {
            var variant = fallbackOrder[i][0];
            var payment = fallbackOrder[i][1];
            if (matrix[variant][payment]) {
                return { variant: variant, payment: payment };
            }
        }

        return null;
    }

    function hasVariantOffer(variant) {
        if (!pricingModel || !pricingModel.offers[variant]) return false;
        return !!(pricingModel.offers[variant].jednorazowo || pricingModel.offers[variant].raty);
    }

    function getSelectedOffer() {
        if (!pricingModel) return null;
        return pricingModel.offers[pricingSelection.variant][pricingSelection.payment];
    }

    function getTierLimit(variant, offer) {
        var directLimit = offer ? toNumberOrNull(offer.tierLimit) : null;
        if (directLimit !== null) return directLimit;

        var otherPayment = offer && offer.tierType === 'RATY' ? 'jednorazowo' : 'raty';
        var pairedOffer = pricingModel.offers[variant][otherPayment];
        return pairedOffer ? toNumberOrNull(pairedOffer.tierLimit) : null;
    }

    function getAvailabilityState(offer, variant) {
        var seats = pricingModel.seats || {};
        var tierLimit = getTierLimit(variant, offer);
        var sold = toNumberOrNull(seats.sold);
        var remaining = toNumberOrNull(seats.remaining);
        var isPoolSoldOut = tierLimit !== null && sold !== null && sold >= tierLimit;
        var isTotalSoldOut = remaining !== null && remaining === 0;
        var lacksSeatsForDuo = variant === 'duo' && remaining !== null && remaining < 2;
        var isPurchaseBlocked = isPoolSoldOut || isTotalSoldOut || lacksSeatsForDuo;
        var statusText = '';

        if (isTotalSoldOut) {
            statusText = 'Wyprzedane';
        } else if (lacksSeatsForDuo) {
            statusText = 'Dostępne tylko 1 miejsce';
        } else if (isPoolSoldOut) {
            statusText = 'Wyprzedane w tej puli';
        }

        return {
            tierLimit: tierLimit,
            sold: sold,
            remaining: remaining,
            isPoolSoldOut: isPoolSoldOut,
            isTotalSoldOut: isTotalSoldOut,
            lacksSeatsForDuo: lacksSeatsForDuo,
            isPurchaseBlocked: isPurchaseBlocked,
            statusText: statusText
        };
    }

    function renderAvailabilityAlert(availability) {
        if (!availability || availability.isTotalSoldOut || availability.isPoolSoldOut) return '';

        if (availability.lacksSeatsForDuo) {
            return '<div class="cpw-availability-alert cpw-availability-critical" role="status">'
                + '<div class="cpw-availability-text">Zostało tylko 1 miejsce. Wybierz opcję „Jadę sam(a)”, aby dokonać rezerwacji.</div>'
            + '</div>';
        }

        if (availability.tierLimit === null || availability.sold === null) return '';

        var remainingInPool = availability.tierLimit - availability.sold;
        if (remainingInPool < 0) remainingInPool = 0;

        var percentRemaining = availability.tierLimit > 0
            ? (remainingInPool / availability.tierLimit) * 100
            : 0;
        if (percentRemaining > 100) percentRemaining = 100;
        if (percentRemaining >= 50) return '';

        return '<div class="cpw-availability-alert" role="status">'
            + '<div class="cpw-availability-text">Zostało tylko <strong>' + escapeHtml(String(remainingInPool)) + '</strong> miejsc w tej puli</div>'
            + '<div class="cpw-availability-progress" aria-hidden="true">'
                + '<div class="cpw-availability-progress-fill" style="width: ' + percentRemaining + '%"></div>'
            + '</div>'
        + '</div>';
    }

    function getDuoBenefit(payment) {
        if (payment === 'raty') return 'We dwoje taniej';

        var soloOffer = pricingModel.offers.solo.jednorazowo;
        var duoOffer = pricingModel.offers.duo.jednorazowo;
        var soloPrice = soloOffer ? toNumberOrNull(soloOffer.salePrice) : null;
        var duoPrice = duoOffer ? toNumberOrNull(duoOffer.salePrice) : null;

        if (soloPrice !== null && duoPrice !== null) {
            var discount = (soloPrice * 2) - duoPrice;
            if (discount > 0) return 'We dwoje taniej o ' + formatMoney(discount) + ' zł';
        }

        return 'We dwoje taniej';
    }

    function getCtaText(variant, payment) {
        if (variant === 'duo' && payment === 'raty') return 'Rezerwuję 2 miejsca w ratach';
        if (variant === 'duo') return 'Rezerwuję 2 miejsca';
        if (payment === 'raty') return 'Rezerwuję miejsce w ratach';
        return 'Rezerwuję miejsce';
    }

    function renderSelectedOffer() {
        var offer = getSelectedOffer();
        if (!offer) return '';

        var variant = pricingSelection.variant;
        var payment = pricingSelection.payment;
        var sectionContent = SECTION_CONFIG[variant];
        var availability = getAvailabilityState(offer, variant);
        var isInstallments = payment === 'raty';
        var salePrice = toNumberOrNull(offer.salePrice);
        var regularPrice = toNumberOrNull(offer.regularPrice);
        var installmentsCount = toNumberOrNull(offer.installmentsCount) || 0;
        var totalCost = salePrice !== null ? installmentsCount * salePrice : null;
        var hasRegularPrice = !isInstallments && regularPrice !== null && salePrice !== null && regularPrice > salePrice;
        var savedAmount = hasRegularPrice ? regularPrice - salePrice : null;
        var typeLabel = offer.displayName || (isInstallments ? 'Płatność ratalna' : 'Płatność jednorazowa');
        var originalPriceMarkup = '<div class="cpw-price-original cpw-hidden" aria-hidden="true"></div>';
        var priceAmountMarkup = '';
        var priceInfoText = '';
        var priceSavedText = '';
        var priceSavedClass = '';
        var priceExtraText = '';
        var benefitMarkup = '';

        if (hasRegularPrice) {
            originalPriceMarkup = '<div class="cpw-price-original"><span class="cpw-price-strike">'
                + formatMoney(regularPrice) + ' zł'
            + '</span></div>';
        }

        if (isInstallments) {
            priceAmountMarkup = '<div class="cpw-price-amount">'
                + '<span class="cpw-installment-prefix">' + escapeHtml(String(installmentsCount)) + '×</span>'
                + '<span>' + formatMoney(salePrice) + ' zł</span>'
            + '</div>';
            priceInfoText = totalCost !== null ? 'W sumie ' + formatMoney(totalCost) + ' zł' : '';
            priceSavedText = 'Raty płatne co miesiąc';
            priceSavedClass = ' cpw-price-saved-accent';
        } else {
            priceAmountMarkup = '<div class="cpw-price-amount">' + formatMoney(salePrice) + ' zł</div>';
            priceInfoText = getPriceDeadlineLabel();
            priceSavedText = savedAmount !== null ? 'Oszczędzasz ' + formatMoney(savedAmount) + ' zł!' : '';
            if (variant === 'duo' && salePrice !== null) {
                priceExtraText = formatMoney(salePrice / 2) + ' zł / os.';
            }
        }

        if (variant === 'duo') {
            benefitMarkup = '<div class="cpw-duo-benefit">'
                + '<strong>' + escapeHtml(getDuoBenefit(payment)) + '</strong>'
                + '<span>' + escapeHtml(sectionContent.noteText || '') + '</span>'
            + '</div>';
        }

        var isMissingCartLink = !offer.cartLink;
        var isBlocked = availability.isPurchaseBlocked || isMissingCartLink;
        var statusText = availability.statusText || (isMissingCartLink ? 'Oferta chwilowo niedostępna' : '');
        var statusMarkup = statusText
            ? '<div class="cpw-status-badge" role="status">' + escapeHtml(statusText) + '</div>'
            : '';
        var ctaText = isBlocked ? statusText : getCtaText(variant, payment);
        var ctaMarkup = '<a class="cpw-cta-btn' + (isBlocked ? ' cpw-disabled' : '') + '"'
            + (isBlocked ? ' aria-disabled="true" tabindex="-1"' : ' href="' + escapeHtml(offer.cartLink) + '"')
            + '>' + escapeHtml(ctaText)
            + (isBlocked ? '' : ' <span class="cpw-cta-icon" aria-hidden="true">&rarr;</span>')
        + '</a>';
        var cardMetaText = offer.tierNumber === 1
            ? 'Cena tylko dla uczestników konferencji'
            : (offer.tierDescription || '');
        var cardMetaMarkup = cardMetaText
            ? '<div class="cpw-card-meta">' + escapeHtml(cardMetaText) + '</div>'
            : '';

        return '<div class="cpw-card-variant">' + escapeHtml(sectionContent.cardVariantTitle) + '</div>'
            + statusMarkup
            + '<div class="cpw-card-top">'
                + '<h3 class="cpw-card-title">' + escapeHtml(typeLabel) + '</h3>'
                + '<p class="cpw-card-desc">' + escapeHtml(sectionContent.roomLabel) + '</p>'
            + '</div>'
            + '<div class="cpw-controls-host" id="cpw-controls-host"></div>'
            + '<div class="cpw-card-bottom">'
                + '<div class="cpw-price-display">'
                    + originalPriceMarkup
                    + priceAmountMarkup
                    + '<div class="cpw-price-info">' + escapeHtml(priceInfoText) + '</div>'
                    + '<div class="cpw-price-saved' + priceSavedClass + '">' + escapeHtml(priceSavedText) + '</div>'
                    + '<div class="cpw-price-extra">' + escapeHtml(priceExtraText) + '</div>'
                    + benefitMarkup
                + '</div>'
                + ctaMarkup
                + cardMetaMarkup
                + renderAvailabilityAlert(availability)
            + '</div>';
    }

    function renderConfiguratorShell(container) {
        container.innerHTML = '<div class="cpw-results">'
            + '<article class="cpw-configurator cpw-theme-solo" id="cpw-configurator" aria-label="Konfigurator ceny Camp 2.0">'
                + '<div class="cpw-price-controls" id="cpw-controls-slot"></div>'
                + '<div class="cpw-card-content" id="cpw-card-content" aria-live="polite" aria-atomic="true"></div>'
            + '</article>'
        + '</div>';
    }

    function renderControlsShell(slot) {
        slot.innerHTML = '<div class="cpw-toggle-stack">'
            + '<fieldset class="cpw-toggle-fieldset">'
                + '<legend class="cpw-visually-hidden">Z kim jedziesz?</legend>'
                + '<div class="cpw-inline-toggle">'
                    + '<button class="cpw-toggle-option" type="button" data-cpw-variant="solo">Jadę sam(a)</button>'
                    + '<label class="cpw-mini-switch">'
                        + '<span class="cpw-visually-hidden">Przełącz liczbę osób</span>'
                        + '<input class="cpw-mini-switch-input" type="checkbox" role="switch" id="cpw-variant-switch" aria-label="Jedziemy w 2 osoby">'
                        + '<span class="cpw-mini-switch-track" aria-hidden="true"></span>'
                    + '</label>'
                    + '<button class="cpw-toggle-option" type="button" data-cpw-variant="duo">Jedziemy w 2 osoby</button>'
                + '</div>'
            + '</fieldset>'
            + '<fieldset class="cpw-toggle-fieldset">'
                + '<legend class="cpw-visually-hidden">Jak chcesz zapłacić?</legend>'
                + '<div class="cpw-inline-toggle">'
                    + '<button class="cpw-toggle-option" type="button" data-cpw-payment="jednorazowo">Jednorazowo</button>'
                    + '<label class="cpw-mini-switch">'
                        + '<span class="cpw-visually-hidden">Przełącz sposób płatności</span>'
                        + '<input class="cpw-mini-switch-input" type="checkbox" role="switch" id="cpw-payment-switch" aria-label="Płatność ratalna">'
                        + '<span class="cpw-mini-switch-track" aria-hidden="true"></span>'
                    + '</label>'
                    + '<button class="cpw-toggle-option" type="button" data-cpw-payment="raty">Raty</button>'
                + '</div>'
            + '</fieldset>'
        + '</div>';
        slot.hidden = false;
    }

    function updateControls() {
        var widget = document.getElementById('camp2-pricing-widget');
        if (!widget || !pricingModel) return;

        var soloButton = widget.querySelector('[data-cpw-variant="solo"]');
        var duoButton = widget.querySelector('[data-cpw-variant="duo"]');
        var onceButton = widget.querySelector('[data-cpw-payment="jednorazowo"]');
        var installmentsButton = widget.querySelector('[data-cpw-payment="raty"]');
        var variantSwitch = widget.querySelector('#cpw-variant-switch');
        var paymentSwitch = widget.querySelector('#cpw-payment-switch');
        var hasSolo = hasVariantOffer('solo');
        var hasDuo = hasVariantOffer('duo');
        var hasOnce = !!pricingModel.offers[pricingSelection.variant].jednorazowo;
        var hasInstallments = !!pricingModel.offers[pricingSelection.variant].raty;

        soloButton.disabled = !hasSolo;
        duoButton.disabled = !hasDuo;
        onceButton.disabled = !hasOnce;
        installmentsButton.disabled = !hasInstallments;
        variantSwitch.disabled = !(hasSolo && hasDuo);
        paymentSwitch.disabled = !(hasOnce && hasInstallments);

        variantSwitch.checked = pricingSelection.variant === 'duo';
        paymentSwitch.checked = pricingSelection.payment === 'raty';
        variantSwitch.setAttribute('aria-checked', String(variantSwitch.checked));
        paymentSwitch.setAttribute('aria-checked', String(paymentSwitch.checked));

        soloButton.classList.toggle('cpw-selected', pricingSelection.variant === 'solo');
        duoButton.classList.toggle('cpw-selected', pricingSelection.variant === 'duo');
        onceButton.classList.toggle('cpw-selected', pricingSelection.payment === 'jednorazowo');
        installmentsButton.classList.toggle('cpw-selected', pricingSelection.payment === 'raty');
        soloButton.setAttribute('aria-pressed', String(pricingSelection.variant === 'solo'));
        duoButton.setAttribute('aria-pressed', String(pricingSelection.variant === 'duo'));
        onceButton.setAttribute('aria-pressed', String(pricingSelection.payment === 'jednorazowo'));
        installmentsButton.setAttribute('aria-pressed', String(pricingSelection.payment === 'raty'));
    }

    function prefersReducedMotion() {
        return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }

    function updatePricingCard(shouldAnimate) {
        var widget = document.getElementById('camp2-pricing-widget');
        if (!widget) return;

        var card = widget.querySelector('#cpw-configurator');
        var content = widget.querySelector('#cpw-card-content');
        if (!card || !content) return;

        if (activeCardAnimation) {
            activeCardAnimation.cancel();
            activeCardAnimation = null;
            content.style.height = '';
        }

        var oldHeight = content.getBoundingClientRect().height;
        var controlsSlot = widget.querySelector('#cpw-controls-slot');
        if (controlsSlot && content.contains(controlsSlot)) {
            card.insertBefore(controlsSlot, content);
        }
        var offer = getSelectedOffer();
        var availability = getAvailabilityState(offer, pricingSelection.variant);

        updateControls();
        card.classList.toggle('cpw-theme-solo', pricingSelection.variant === 'solo');
        card.classList.toggle('cpw-theme-duo', pricingSelection.variant === 'duo');
        card.classList.toggle('cpw-purchase-blocked', availability.isPurchaseBlocked || !offer.cartLink);
        content.innerHTML = renderSelectedOffer();
        var controlsHost = content.querySelector('#cpw-controls-host');
        if (controlsSlot && controlsHost) {
            controlsHost.parentNode.replaceChild(controlsSlot, controlsHost);
        }

        var newHeight = content.scrollHeight;
        if (!shouldAnimate || prefersReducedMotion() || !content.animate || oldHeight === 0 || newHeight === 0) {
            content.style.height = '';
            return;
        }

        content.style.height = newHeight + 'px';
        activeCardAnimation = content.animate([
            { height: oldHeight + 'px', opacity: 0.42, transform: 'translateY(8px)' },
            { height: newHeight + 'px', opacity: 1, transform: 'translateY(0)' }
        ], {
            duration: 300,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
        });

        activeCardAnimation.onfinish = function() {
            content.style.height = '';
            activeCardAnimation = null;
        };
        activeCardAnimation.oncancel = function() {
            content.style.height = '';
        };
    }

    function bindConfiguratorEvents() {
        var widget = document.getElementById('camp2-pricing-widget');
        if (!widget) return;

        function selectVariant(variant) {
            if (!hasVariantOffer(variant) || pricingSelection.variant === variant) {
                updateControls();
                return;
            }

            pricingSelection.variant = variant;
            if (!pricingModel.offers[variant][pricingSelection.payment]) {
                pricingSelection.payment = pricingModel.offers[variant].jednorazowo
                    ? 'jednorazowo'
                    : 'raty';
            }
            updatePricingCard(true);
        }

        function selectPayment(payment) {
            if (!pricingModel.offers[pricingSelection.variant][payment] || pricingSelection.payment === payment) {
                updateControls();
                return;
            }
            pricingSelection.payment = payment;
            updatePricingCard(true);
        }

        var variantButtons = widget.querySelectorAll('[data-cpw-variant]');
        var paymentButtons = widget.querySelectorAll('[data-cpw-payment]');
        var variantSwitch = widget.querySelector('#cpw-variant-switch');
        var paymentSwitch = widget.querySelector('#cpw-payment-switch');

        for (var i = 0; i < variantButtons.length; i++) {
            variantButtons[i].addEventListener('click', function(event) {
                selectVariant(event.currentTarget.getAttribute('data-cpw-variant'));
            });
        }

        for (var j = 0; j < paymentButtons.length; j++) {
            paymentButtons[j].addEventListener('click', function(event) {
                selectPayment(event.currentTarget.getAttribute('data-cpw-payment'));
            });
        }

        variantSwitch.addEventListener('change', function(event) {
            selectVariant(event.target.checked ? 'duo' : 'solo');
        });

        paymentSwitch.addEventListener('change', function(event) {
            selectPayment(event.target.checked ? 'raty' : 'jednorazowo');
        });
    }

    function renderAllSections(container, data) {
        if (!container) return;

        pricingModel = {
            offers: buildOfferMatrix(data.pricing || []),
            seats: data.seats || { total: null, sold: null, remaining: null }
        };

        var initialSelection = chooseInitialSelection(pricingModel.offers);
        if (!initialSelection) {
            container.innerHTML = '<p style="text-align:center;color:#64748b;padding:20px;">Brak aktywnych ofert do wyświetlenia.</p>';
            return;
        }

        pricingSelection = initialSelection;
        renderConfiguratorShell(container);
        var controlsSlot = container.querySelector('#cpw-controls-slot');
        if (controlsSlot) renderControlsShell(controlsSlot);
        bindConfiguratorEvents();
        updatePricingCard(false);
    }

    function renderMissingPaymentCard(variant, payment) {
        var sectionContent = SECTION_CONFIG[variant];
        var paymentTitle = getPaymentTitle(null, payment === 'raty');

        return '<article class="cpw-payment-card cpw-theme-' + escapeHtml(variant) + ' cpw-offer-missing" aria-label="' + escapeHtml(paymentTitle) + ' — oferta niedostępna">'
            + '<div class="cpw-card-variant">' + escapeHtml(sectionContent.cardVariantTitle) + '</div>'
            + '<div class="cpw-card-top">'
                + '<h3 class="cpw-card-title">' + escapeHtml(paymentTitle) + '</h3>'
                + renderRoomDescription(sectionContent)
            + '</div>'
            + '<div class="cpw-card-bottom">'
                + '<div class="cpw-price-display">'
                    + '<div class="cpw-status-badge" role="status">Oferta niedostępna</div>'
                    + '<div class="cpw-card-meta">Ta forma płatności nie jest obecnie dostępna.</div>'
                + '</div>'
                + '<span class="cpw-cta-btn cpw-disabled" role="button" aria-disabled="true">Oferta niedostępna</span>'
            + '</div>'
        + '</article>';
    }

    function renderPaymentCard(variant, payment) {
        var offer = pricingModel.offers[variant][payment];
        if (!offer) return renderMissingPaymentCard(variant, payment);

        var sectionContent = SECTION_CONFIG[variant];
        var availability = getAvailabilityState(offer, variant);
        var isInstallments = payment === 'raty';
        var salePrice = toNumberOrNull(offer.salePrice);
        var regularPrice = toNumberOrNull(offer.regularPrice);
        var installmentsCount = toNumberOrNull(offer.installmentsCount) || 0;
        var totalCost = salePrice !== null ? installmentsCount * salePrice : null;
        var hasRegularPrice = !isInstallments && regularPrice !== null && salePrice !== null && regularPrice > salePrice;
        var savedAmount = hasRegularPrice ? regularPrice - salePrice : null;
        var typeLabel = getPaymentTitle(offer, isInstallments);
        var originalPriceMarkup = '<div class="cpw-price-original cpw-hidden" aria-hidden="true"></div>';
        var priceAmountMarkup = '';
        var priceSavedText = '';
        var priceExtraText = '';
        var benefitMarkup = '';

        if (hasRegularPrice) {
            originalPriceMarkup = '<div class="cpw-price-original"><span class="cpw-price-strike">'
                + formatMoney(regularPrice) + ' zł'
            + '</span></div>';
        }

        if (isInstallments) {
            priceAmountMarkup = '<div class="cpw-price-amount">'
                + '<span class="cpw-installment-prefix">' + escapeHtml(String(installmentsCount)) + '×</span>'
                + '<span>' + formatMoney(salePrice) + ' zł</span>'
            + '</div>';
        } else {
            priceAmountMarkup = '<div class="cpw-price-amount">' + formatMoney(salePrice) + ' zł</div>';
            priceSavedText = savedAmount !== null ? 'Oszczędzasz ' + formatMoney(savedAmount) + ' zł!' : '';
            if (variant === 'duo' && salePrice !== null) {
                priceExtraText = formatMoney(salePrice / 2) + ' zł / os.';
            }
        }

        if (variant === 'duo') {
            benefitMarkup = '<div class="cpw-duo-benefit">'
                + '<strong>' + escapeHtml(getDuoBenefit(payment)) + '</strong>'
                + '<span>' + escapeHtml(sectionContent.noteText || '') + '</span>'
            + '</div>';
        }

        var isMissingCartLink = !offer.cartLink;
        var isBlocked = availability.isPurchaseBlocked || isMissingCartLink;
        var statusText = availability.statusText || (isMissingCartLink ? 'Oferta chwilowo niedostępna' : '');
        var statusMarkup = statusText
            ? '<div class="cpw-status-badge" role="status">' + escapeHtml(statusText) + '</div>'
            : '';
        var ctaText = isBlocked ? statusText : getCtaText(variant, payment);
        var ctaMarkup = isBlocked
            ? '<span class="cpw-cta-btn cpw-disabled" role="button" aria-disabled="true">' + escapeHtml(ctaText) + '</span>'
            : '<a class="cpw-cta-btn" href="' + escapeHtml(offer.cartLink) + '">' + escapeHtml(ctaText) + ' <span class="cpw-cta-icon" aria-hidden="true">&rarr;</span></a>';
        var priceSavedMarkup = priceSavedText
            ? '<div class="cpw-price-saved">' + escapeHtml(priceSavedText) + '</div>'
            : '<div class="cpw-price-saved cpw-hidden" aria-hidden="true"></div>';
        var paymentSummaryMarkup = renderPaymentSummary(isInstallments, salePrice, installmentsCount, totalCost, regularPrice);

        return '<article class="cpw-payment-card cpw-theme-' + escapeHtml(variant) + (isBlocked ? ' cpw-purchase-blocked' : '') + '" aria-label="' + escapeHtml(typeLabel) + '">'
            + '<div class="cpw-card-variant">' + escapeHtml(sectionContent.cardVariantTitle) + '</div>'
            + statusMarkup
            + '<div class="cpw-card-top">'
                + '<h3 class="cpw-card-title">' + escapeHtml(typeLabel) + '</h3>'
                + renderRoomDescription(sectionContent)
            + '</div>'
            + '<div class="cpw-card-bottom">'
                + '<div class="cpw-price-display">'
                    + '<div class="cpw-price-stack">'
                        + originalPriceMarkup
                        + priceAmountMarkup
                    + '</div>'
                    + priceSavedMarkup
                    + '<div class="cpw-price-extra">' + escapeHtml(priceExtraText) + '</div>'
                    + benefitMarkup
                + '</div>'
                + ctaMarkup
                + paymentSummaryMarkup
                + renderAvailabilityAlert(availability)
            + '</div>'
        + '</article>';
    }

    function renderStepFlowShell(container) {
        container.innerHTML = '<div class="cpw-results">'
            + '<div class="cpw-step-flow">'
                + '<section class="cpw-flow-step" id="cpw-attendance-step">'
                    + '<h2 class="cpw-flow-step-title">Krok 1: Jak jedziesz?</h2>'
                    + '<fieldset class="cpw-toggle-fieldset">'
                        + '<legend class="cpw-visually-hidden">Wybierz liczbę osób</legend>'
                        + '<div class="cpw-segmented-control cpw-attendance-control" id="cpw-attendance-control">'
                            + '<span class="cpw-segment-indicator" aria-hidden="true"></span>'
                            + '<input class="cpw-segment-input" type="radio" name="cpw-attendance" id="cpw-attendance-solo" value="solo">'
                            + '<label class="cpw-segment-option" for="cpw-attendance-solo">Jadę sam(a)</label>'
                            + '<input class="cpw-segment-input" type="radio" name="cpw-attendance" id="cpw-attendance-duo" value="duo">'
                            + '<label class="cpw-segment-option" for="cpw-attendance-duo">Jedziemy w 2&nbsp;osoby</label>'
                        + '</div>'
                    + '</fieldset>'
                + '</section>'
                + '<section class="cpw-flow-step" id="cpw-payment-step" aria-hidden="true" hidden>'
                    + '<h2 class="cpw-flow-step-title" id="cpw-payment-step-title" tabindex="-1">Krok 2: Jaką opcję płatności wybierasz?</h2>'
                    + '<div class="cpw-payment-cards-grid" id="cpw-payment-cards" aria-live="polite"></div>'
                + '</section>'
            + '</div>'
        + '</div>';
    }

    function updateAttendanceControl() {
        var widget = document.getElementById('camp2-pricing-widget');
        if (!widget) return;

        var control = widget.querySelector('#cpw-attendance-control');
        var soloInput = widget.querySelector('#cpw-attendance-solo');
        var duoInput = widget.querySelector('#cpw-attendance-duo');
        if (!control || !soloInput || !duoInput) return;

        soloInput.disabled = !hasVariantOffer('solo');
        duoInput.disabled = !hasVariantOffer('duo');
        soloInput.checked = pricingSelection.variant === 'solo';
        duoInput.checked = pricingSelection.variant === 'duo';
        control.classList.toggle('cpw-has-selection', !!pricingSelection.variant);
        control.classList.toggle('cpw-second-selected', pricingSelection.variant === 'duo');
    }

    function scrollToPaymentStep(step) {
        if (!step) return;
        if (!window.matchMedia || !window.matchMedia('(max-width: 767px)').matches) return;

        setTimeout(function() {
            step.scrollIntoView({
                behavior: prefersReducedMotion() ? 'auto' : 'smooth',
                block: 'start'
            });
        }, 180);
    }

    function renderPaymentCardsForVariant(variant) {
        var widget = document.getElementById('camp2-pricing-widget');
        if (!widget) return;

        var step = widget.querySelector('#cpw-payment-step');
        var cardsContainer = widget.querySelector('#cpw-payment-cards');
        if (!step || !cardsContainer) return;

        if (activeStepAnimation) {
            activeStepAnimation.cancel();
            activeStepAnimation = null;
            step.style.height = '';
            step.style.overflow = '';
        }

        var wasHidden = step.hidden;
        cardsContainer.innerHTML = renderPaymentCard(variant, 'jednorazowo')
            + renderPaymentCard(variant, 'raty');
        step.hidden = false;
        step.setAttribute('aria-hidden', 'false');

        /* Reserve the final Landingi host height before WAAPI starts. Without
           this synchronous pass the animated content can overflow the old,
           collapsed section until ResizeObserver fires after the animation. */
        reserveLandingiHeight(widget, 800);

        if (prefersReducedMotion() || !step.animate) {
            reserveLandingiHeight(widget, 300);
            scrollToPaymentStep(step);
            return;
        }

        if (wasHidden) {
            var targetHeight = step.scrollHeight;
            step.style.height = targetHeight + 'px';
            step.style.overflow = 'hidden';
            activeStepAnimation = step.animate([
                { height: '0px', opacity: 0, transform: 'translateY(12px)' },
                { height: targetHeight + 'px', opacity: 1, transform: 'translateY(0)' }
            ], {
                duration: 320,
                easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
            });
        } else {
            activeStepAnimation = cardsContainer.animate([
                { opacity: 0.35, transform: 'translateY(8px)' },
                { opacity: 1, transform: 'translateY(0)' }
            ], {
                duration: 260,
                easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
            });
        }

        activeStepAnimation.onfinish = function() {
            step.style.height = '';
            step.style.overflow = '';
            activeStepAnimation = null;
            reserveLandingiHeight(widget, 250);
        };
        activeStepAnimation.oncancel = function() {
            step.style.height = '';
            step.style.overflow = '';
        };

        scrollToPaymentStep(step);
    }

    function bindStepFlowEvents() {
        var widget = document.getElementById('camp2-pricing-widget');
        if (!widget) return;

        var inputs = widget.querySelectorAll('input[name="cpw-attendance"]');
        for (var i = 0; i < inputs.length; i++) {
            inputs[i].addEventListener('change', function(event) {
                if (!event.target.checked || !hasVariantOffer(event.target.value)) return;
                pricingSelection.variant = event.target.value;
                updateAttendanceControl();
                renderPaymentCardsForVariant(pricingSelection.variant);
            });
        }
    }

    function renderStepFlow(container, data) {
        if (!container) return;

        pricingModel = {
            offers: buildOfferMatrix(data.pricing || []),
            seats: data.seats || { total: null, sold: null, remaining: null }
        };
        pricingSelection = { variant: null };

        if (!hasVariantOffer('solo') && !hasVariantOffer('duo')) {
            container.innerHTML = '<p style="text-align:center;color:#64748b;padding:20px;">Brak aktywnych ofert do wyświetlenia.</p>';
            return;
        }

        renderStepFlowShell(container);
        updateAttendanceControl();
        bindStepFlowEvents();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCamp2Widget);
    } else {
        initCamp2Widget();
    }

    async function initCamp2Widget() {
        if (window.camp2PricingWidgetInit) return;
        window.camp2PricingWidgetInit = true;

        debugLog('INICJALIZACJA WIDGETU CAMP 2.0');

        var widget = document.getElementById('camp2-pricing-widget');
        if (!widget) return;

        var loadingEl = widget.querySelector('#cpw-loading');
        var resultsContainer = widget.querySelector('#cpw-results');
        var data = await fetchConfig();

        if (loadingEl) loadingEl.style.display = 'none';

        if (!data || !data.pricing || data.pricing.length === 0) {
            if (resultsContainer) {
                resultsContainer.innerHTML = '<p style="text-align:center;color:#64748b;padding:20px;">Nie udało się załadować cennika. Odśwież stronę.</p>';
            }
            return;
        }

        countdownTargetDate = parseEndDate(data.pricing[0].endDate);
        initCountdown();
        renderStepFlow(resultsContainer, data);

        debugLog('INICJALIZACJA ZAKOŃCZONA');
    }

    function initCountdown() {
        var targetDate = getCountdownTargetDate();
        if (!targetDate) return;
        var countdownContainer = document.querySelector('#camp2-pricing-widget .cpw-countdown-container');
        var countdownVisibilityThreshold = 14 * 24 * 60 * 60 * 1000;

        var deadlineEl = document.getElementById('cpw-deadline');
        if (deadlineEl) {
            var day = targetDate.getDate();
            var monthName = COUNTDOWN_MONTH_NAMES[targetDate.getMonth()];
            var year = targetDate.getFullYear();
            var hours = String(targetDate.getHours()).padStart(2, '0');
            var minutes = String(targetDate.getMinutes()).padStart(2, '0');
            deadlineEl.textContent = day + ' ' + monthName + ' ' + year + ' roku, do godz. ' + hours + ':' + minutes;
        }

        function updateCountdown() {
            var now = new Date();
            var difference = targetDate - now;

            if (countdownContainer) {
                countdownContainer.style.display = difference > countdownVisibilityThreshold ? 'none' : '';
            }

            if (difference > countdownVisibilityThreshold) {
                return;
            }

            if (difference > 0) {
                var days = Math.floor(difference / (1000 * 60 * 60 * 24));
                var hrs = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                var mins = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
                var secs = Math.floor((difference % (1000 * 60)) / 1000);

                var daysEl = document.getElementById('cpw-days');
                var hoursEl = document.getElementById('cpw-hours');
                var minutesEl = document.getElementById('cpw-minutes');
                var secondsEl = document.getElementById('cpw-seconds');

                if (daysEl) daysEl.textContent = String(days).padStart(2, '0');
                if (hoursEl) hoursEl.textContent = String(hrs).padStart(2, '0');
                if (minutesEl) minutesEl.textContent = String(mins).padStart(2, '0');
                if (secondsEl) secondsEl.textContent = String(secs).padStart(2, '0');
            } else {
                if (countdownContainer) {
                    countdownContainer.innerHTML = '<div style="padding: 20px; font-size: 18px; font-weight: 700; color: #370F11;">Promocja zakończona</div>';
                }
            }
        }

        updateCountdown();
        setInterval(updateCountdown, 1000);
    }
})();

(function() {
    var startLandingiHeightManager = function() {
    var RETRY_DELAY = 200;
    var MOBILE_QUERY = '(max-width: 767px)';
    var MOBILE_BOTTOM_GAP = 16;
    var DESKTOP_BOTTOM_GAP = 32;
    var STABILITY_DELAYS = [0, 32, 100, 180, 320, 500, 900];
    var widgetEl = null;
    var retryTimeoutId = null;
    var resizeTimeoutId = null;
    var reservationTimeoutId = null;
    var observedWidget = null;
    var observedStep = null;
    var scheduled = false;
    var reservedWidgetHeight = 0;
    var reservationUntil = 0;

    var findWidget = function() {
        if (widgetEl && document.contains(widgetEl)) return widgetEl;
        var global = document.getElementById('camp2-pricing-widget');
        if (global) {
            widgetEl = global;
            return widgetEl;
        }
        return null;
    };

    var getEmbedContext = function(widget) {
        var htmlWidget = widget.closest('.widget-html');
        var hostContainer = htmlWidget ? htmlWidget.closest('.container') : null;
        var section = hostContainer ? hostContainer.closest('.widget-section') : null;
        var row = hostContainer ? hostContainer.closest('.row') : null;
        return {
            htmlWidget: htmlWidget,
            hostContainer: hostContainer,
            section: section,
            row: row
        };
    };

    var scheduleRetry = function() {
        if (retryTimeoutId) return;
        retryTimeoutId = setTimeout(function() {
            retryTimeoutId = null;
            fixSectionHeight();
        }, RETRY_DELAY);
    };

    var getReservedHeight = function() {
        if (reservedWidgetHeight && performance.now() >= reservationUntil) {
            reservedWidgetHeight = 0;
            reservationUntil = 0;
        }
        return reservedWidgetHeight;
    };

    var fixSectionHeight = function(requestedWidgetHeight) {
        var widget = findWidget();
        if (!widget) {
            scheduleRetry();
            return;
        }
        var context = getEmbedContext(widget);
        if (!context.section || !context.hostContainer || !context.htmlWidget) return;

        var widgetHeight = Math.ceil(Math.max(
            widget.offsetHeight,
            widget.scrollHeight,
            Number(requestedWidgetHeight) || 0,
            getReservedHeight()
        ));
        if (!widgetHeight) return;

        var containerRect = context.hostContainer.getBoundingClientRect();
        var widgetRect = widget.getBoundingClientRect();
        var topOffset = Math.max(0, Math.ceil(widgetRect.top - containerRect.top));
        var bottomGap = window.matchMedia(MOBILE_QUERY).matches
            ? MOBILE_BOTTOM_GAP
            : DESKTOP_BOTTOM_GAP;
        var hostHeight = topOffset + widgetHeight + bottomGap;

        /* The custom HTML widget is absolutely positioned by Landingi on
           every breakpoint. Keep every normal-flow ancestor in sync with the
           real content height, otherwise the following section can overlap
           during the reveal animation (desktop) or leave a gap (mobile). */
        context.htmlWidget.style.setProperty('height', widgetHeight + 'px', 'important');
        context.hostContainer.style.setProperty('height', hostHeight + 'px', 'important');
        context.hostContainer.style.setProperty('min-height', hostHeight + 'px', 'important');
        if (context.row) context.row.style.setProperty('min-height', hostHeight + 'px', 'important');
        context.section.style.setProperty('height', hostHeight + 'px', 'important');
        context.section.style.setProperty('min-height', hostHeight + 'px', 'important');
    };

    var scheduleStabilityPasses = function() {
        for (var i = 0; i < STABILITY_DELAYS.length; i++) {
            setTimeout(fixSectionHeight, STABILITY_DELAYS[i]);
        }
    };

    var reserveHeight = function(widgetHeight, duration) {
        var height = Math.ceil(Number(widgetHeight) || 0);
        if (!height) return;

        var holdDuration = Math.max(250, Number(duration) || 700);
        reservedWidgetHeight = Math.max(reservedWidgetHeight, height);
        reservationUntil = performance.now() + holdDuration;

        clearTimeout(reservationTimeoutId);
        reservationTimeoutId = setTimeout(function() {
            reservedWidgetHeight = 0;
            reservationUntil = 0;
            scheduleStabilityPasses();
        }, holdDuration + 40);

        /* This call is intentionally synchronous. It moves the following
           Landingi section before the reveal animation can paint a frame. */
        fixSectionHeight(reservedWidgetHeight);
        scheduleStabilityPasses();
    };

    var scheduleFix = function() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(function() {
            scheduled = false;
            fixSectionHeight();
        });
    };

    document.addEventListener('camp2:reserve-height', function(event) {
        var detail = event.detail || {};
        reserveHeight(detail.widgetHeight, detail.duration);
    });

    var mutationObserver = new MutationObserver(function() {
        var widget = findWidget();
        var step = widget ? widget.querySelector('#cpw-payment-step') : null;
        if (resizeObserver && step && observedStep !== step) {
            if (observedStep) resizeObserver.unobserve(observedStep);
            resizeObserver.observe(step);
            observedStep = step;
        }
        scheduleFix();
    });

    var resizeObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver(scheduleFix)
        : null;
    var startResizeObserver = function() {
        var widget = findWidget();
        if (widget) {
            mutationObserver.disconnect();
            mutationObserver.observe(widget, {
                childList: true,
                subtree: true,
                attributes: true,
                characterData: true
            });
            if (resizeObserver && observedWidget !== widget) {
                if (observedWidget) resizeObserver.unobserve(observedWidget);
                resizeObserver.observe(widget);
                observedWidget = widget;
            }
            var step = widget.querySelector('#cpw-payment-step');
            if (resizeObserver && step && observedStep !== step) {
                if (observedStep) resizeObserver.unobserve(observedStep);
                resizeObserver.observe(step);
                observedStep = step;
            }
            scheduleStabilityPasses();
        } else {
            setTimeout(startResizeObserver, 200);
        }
    };
    startResizeObserver();

    window.addEventListener('resize', function() {
        clearTimeout(resizeTimeoutId);
        reservedWidgetHeight = 0;
        reservationUntil = 0;
        resizeTimeoutId = setTimeout(scheduleStabilityPasses, 150);
    });

        window.addEventListener('load', scheduleStabilityPasses);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startLandingiHeightManager, { once: true });
    } else {
        startLandingiHeightManager();
    }
})();
