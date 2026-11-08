"""Hebrew text the API itself sends (emails). Web component strings live in web/src/locales/he.json.
Placeholders: Slice 9 owns the final wording."""

EMAIL_OTP_SUBJECT = "קוד הכניסה שלך"
# The code sits alone on its own line so bidi reordering cannot scramble it among Hebrew words.
EMAIL_OTP_BODY = (
    "הקוד שלך לכניסה:\n{code}\nהקוד תקף ל-10 דקות. אם לא ביקשת אותו, אפשר להתעלם מההודעה."
)
