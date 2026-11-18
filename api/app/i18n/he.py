"""Hebrew text the API itself sends (emails). Web component strings live in web/src/locales/he.json.
Placeholders: Slice 9 owns the final wording."""

EMAIL_OTP_SUBJECT = "קוד הכניסה שלך"
# The code sits alone on its own line so bidi reordering cannot scramble it among Hebrew words.
EMAIL_OTP_BODY = (
    "הקוד שלך לכניסה:\n{code}\nהקוד תקף ל-10 דקות. אם לא ביקשת אותו, אפשר להתעלם מההודעה."
)

# Tour emails (spec 0018c). No user text in a subject (a header): names go in the body only.
WEEKDAYS = (
    "יום שני",
    "יום שלישי",
    "יום רביעי",
    "יום חמישי",
    "יום שישי",
    "שבת",
    "יום ראשון",
)  # ISO 1-7
TOUR_WHEN = "{weekday}, {date}, {start}–{end}"
TOUR_WHERE = "רחוב {street}, {city}"
TOUR_ICS_SUMMARY = "סיור: רחוב {street}, {city}"
TOUR_FOOTER = "לצ'אט: {url}\nההודעה נשלחה כי נקבע סיור בהומי."
TOUR_DELETED_NAME = "משתמש/ת שנמחק/ה"
TOUR_FEED_NAME = "סיורים בהומי"
TOUR_FEED_DESCRIPTION = "סיור עם {name}\nלפרטים ולצ'אט: {url}"
TOUR_BOOKED_SUBJECT = "נקבע סיור"
TOUR_BOOKED_LISTER_BODY = "נקבע סיור עם {name}.\n{when}\n{where}\n\n{footer}"
TOUR_BOOKED_SEEKER_BODY = "הסיור נקבע.\n{when}\n{where}\n\n{footer}"
TOUR_RESCHEDULED_SUBJECT = "מועד הסיור השתנה"
TOUR_RESCHEDULED_LISTER_BODY = (
    "מועד הסיור עם {name} השתנה. המועד החדש:\n{when}\n{where}\n\n{footer}"
)
TOUR_RESCHEDULED_SEEKER_BODY = "מועד הסיור השתנה. המועד החדש:\n{when}\n{where}\n\n{footer}"
TOUR_CANCELLED_SUBJECT = "הסיור בוטל"
TOUR_CANCELLED_BODY = "הסיור עם {name} בוטל.\n{when}\n{where}\n\n{footer}"
TOUR_CANCELLED_SYSTEM_BODY = (
    "הסיור עם {name} בוטל כי המודעה או המועמדות כבר לא פעילות.\n{when}\n{where}\n\n{footer}"
)
TOUR_REMINDER_SUBJECT = "תזכורת: סיור מחר"
TOUR_REMINDER_BODY = "תזכורת: מחר יש סיור עם {name}.\n{when}\n{where}\n\n{footer}"

# Security emails (spec 0022a). Each URL and address sits alone on its line, as the OTP code does.
# No run of six digits: e2e's `latestCode` would read it as a login code.
SECURITY_PASSWORD_SUBJECT = "הסיסמה בחשבון הומי שלך עודכנה"
SECURITY_PASSWORD_BODY = (
    "הסיסמה בחשבון הומי שלך נקבעה או שונתה, וכל המכשירים האחרים נותקו מהחשבון.\n\n"
    "אם עשית את זה, אין צורך לעשות דבר.\n\n"
    "לא עשית את זה? צריך להיכנס עכשיו עם קוד חד-פעמי לאימייל ולקבוע סיסמה חדשה. "
    "זה ינתק כל מכשיר אחר מהחשבון:\n{login_url}\n\n"
    "לעזרה:\n{contact}"
)
SECURITY_DELETED_SUBJECT = "חשבון הומי שלך נמחק"
SECURITY_DELETED_BODY = (
    "חשבון הומי שלך נמחק, וכל המכשירים נותקו ממנו. המחיקה סופית.\n\n"
    "לא ביקשת למחוק את החשבון? כדאי לכתוב לנו מיד:\n{contact}"
)
