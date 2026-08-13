from bs4 import BeautifulSoup
html = '<ac:image><ri:attachment ri:filename="image-2024-6-14_10-41-55.png" /></ac:image>'
soup = BeautifulSoup(html, 'html.parser')
print(soup.find_all("ac:image"))
