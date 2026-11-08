# Reads a compose-style `.env` for the Makefile and prints one `KEY?=value` per assignment.
# Accepts KEY=value, KEY="value" and KEY='value' (quotes stripped, as compose does) and CRLF files;
# skips blank and comment lines. Values may not contain spaces, quotes, `$`, `#` or `\` (make would
# mangle them). Any other line prints as `!<line number>` so the Makefile can warn about it.
{ sub(/\r$/, "") }
/^[ \t]*#/ || /^[ \t]*$/ { next }
{
    if (match($0, /^[A-Za-z_][A-Za-z0-9_]*=/)) {
        key = substr($0, 1, RLENGTH - 1)
        value = substr($0, RLENGTH + 1)
        if (value ~ /^"[^"]*"$/ || value ~ /^'[^']*'$/) value = substr(value, 2, length(value) - 2)
        if (value !~ /[ \t"'$#\\]/) { print key "?=" value; next }
    }
    print "!" NR
}
