"""Remove the filled-in values from an External Work Report PDF -> blank template.

Usage: python tools/make_blank_template.py <filled.pdf> template/ewr_template_blank.pdf
Only the label text is kept; every BT..ET text block whose position matches a
value cell (header values, dates, activities, hours, signature name/date) is dropped.
"""
import re
import sys

from pypdf import PdfReader, PdfWriter
from pypdf.generic import ContentStream, NameObject, StreamObject

LABELS = {
    "External Work Report", "Yokogawa Europe Solutions B.V.", "Your opinion counts!",
    "Euroweg 2, 3825 HD Amersfoort", "P.O. Box 163, 3800 AD Amersfoort", "The Netherlands",
    r"Phone: +31 \(0\) 88-4641000", "Link to feedback form.", r"Fax: +31 \(0\) 88-4641111",
    "Client", r"Travel from - to \(city-country\)", "Location", "Yokogawa order number",
    "Requested by", "Intervention number", "Start time on site", "date", "date ",
    "Client reference", "End time on site", "Yokogawa employee name", "Weeknumber",
    "EWR Reference", "Description of activities carried out", " Detailed report attached",
    "No. of pages", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
    "Saturday", "Particular details, follow-up", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri",
    "Sat", "Total", "Pos.", "Qty", "Item specification", "1", "2", "3", "4", "5",
    "\xa0" * 5, "Name: " + "\xa0" * 5, "Function:", "Email:", "Sign: ", "Date:", "Date",
    "By signing this report the client confirms that the job has been completed to above",
    "description, hour accounting and materials. ", "Yokogawa employee", "Signature: ",
    "Name", "working time-22.00-24.00 h", "OffShore", r"traveltime \(optional\)",
    "Overnight stay hotel", "Totals", "Material used", "Serial#/Part#", "Return or single",
    "Preparation time", "Please leave your ", "feedback by scanning ",
    "the QR code or via de ", "URL displayed below.", "working time-17.00-22.00 h",
    "On-site hour accounting", "working time-00.00-08.00 h", "working time-08.00-17.00 h",
}


def main(src, dst):
    reader = PdfReader(src)
    page = reader.pages[0]
    data = page.get_contents().get_data().decode("latin1")
    removed = []

    def repl(m):
        txt = "".join(re.findall(r"\(((?:\\.|[^\\)])*)\)", m.group(1)))
        # "Name" label exists, but a person's name at the same spot is a value
        if txt in LABELS:
            return m.group(0)
        removed.append(txt)
        return "BT\nET"

    data = re.sub(r"BT\s(.*?)\sET", repl, data, flags=re.S)
    writer = PdfWriter()
    wpage = writer.add_page(page)
    stream = StreamObject()
    stream.set_data(data.encode("latin1"))
    stream = stream.flate_encode()
    wpage[NameObject("/Contents")] = writer._add_object(stream)
    # Only a neutral title; the source file's author/label metadata is not copied.
    writer.add_metadata({"/Title": "External Work Report", "/Producer": "", "/Creator": ""})
    writer.compress_identical_objects(remove_duplicates=True, remove_unreferenced=True)
    with open(dst, "wb") as f:
        writer.write(f)
    print("removed:", removed)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
