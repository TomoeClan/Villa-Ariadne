const AIRBNB_ICAL_URL = "https://fr.airbnb.com/calendar/ical/23610154.ics?t=c909f179081343b1a3d2a68c4c12b4f1";
const BOOKING_ICAL_URL = "https://ical.booking.com/v1/export?t=bab2cf71-51b9-4ddd-9f94-b4c9b29c4c72";
const MONTHS_TO_SHOW = 4;
const LOOKAHEAD_DAYS = 370;

function unfoldICal(text) {
  return text.replace(/\r?\n[ \t]/g, "");
}

function parseICalDate(value) {
  const raw = value.trim();

  if (/^\d{8}$/.test(raw)) {
    const year = Number(raw.slice(0, 4));
    const month = Number(raw.slice(4, 6)) - 1;
    const day = Number(raw.slice(6, 8));
    return new Date(Date.UTC(year, month, day));
  }

  if (/^\d{8}T\d{6}Z$/.test(raw)) {
    const year = Number(raw.slice(0, 4));
    const month = Number(raw.slice(4, 6)) - 1;
    const day = Number(raw.slice(6, 8));
    const hour = Number(raw.slice(9, 11));
    const minute = Number(raw.slice(11, 13));
    const second = Number(raw.slice(13, 15));
    return new Date(Date.UTC(year, month, day, hour, minute, second));
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function clipDate(date, minDate, maxDate) {
  if (date < minDate) {
    return minDate;
  }
  if (date > maxDate) {
    return maxDate;
  }
  return date;
}

function collectBlockedDates(icalText, minDate, maxDate) {
  const blockedDates = new Set();
  const lines = unfoldICal(icalText).split(/\r?\n/);
  let currentEvent = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      currentEvent = {};
      continue;
    }

    if (line === "END:VEVENT") {
      if (currentEvent && currentEvent.start && currentEvent.end) {
        const eventStart = clipDate(currentEvent.start, minDate, maxDate);
        const eventEnd = clipDate(currentEvent.end, minDate, maxDate);

        for (let cursor = new Date(eventStart); cursor < eventEnd; cursor = addDays(cursor, 1)) {
          blockedDates.add(toIsoDate(cursor));
        }
      }

      currentEvent = null;
      continue;
    }

    if (!currentEvent) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      continue;
    }

    const rawKey = line.slice(0, separatorIndex);
    const value = line.slice(separatorIndex + 1);
    const key = rawKey.split(";")[0];

    if (key === "DTSTART") {
      currentEvent.start = parseICalDate(value);
    }

    if (key === "DTEND") {
      currentEvent.end = parseICalDate(value);
    }
  }

  return blockedDates;
}

exports.handler = async function handler() {
  try {
    const now = new Date();
    const minDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const maxDate = addDays(minDate, LOOKAHEAD_DAYS);

    const responses = await Promise.all([
      fetch(AIRBNB_ICAL_URL),
      fetch(BOOKING_ICAL_URL)
    ]);

    responses.forEach((response) => {
      if (!response.ok) {
        throw new Error("Failed to load one of the calendar feeds.");
      }
    });

    const [airbnbIcal, bookingIcal] = await Promise.all(
      responses.map((response) => response.text())
    );

    const combinedBlocked = new Set([
      ...collectBlockedDates(airbnbIcal, minDate, maxDate),
      ...collectBlockedDates(bookingIcal, minDate, maxDate)
    ]);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300"
      },
      body: JSON.stringify({
        blockedDates: Array.from(combinedBlocked).sort(),
        monthsToShow: MONTHS_TO_SHOW,
        updatedAt: new Date().toISOString()
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        error: "Unable to load availability feeds."
      })
    };
  }
};
