# When the page does not work

- **A large area fails.** The page needs memory for the area. Estonia (a 121 MB region file) uses about 710 MiB. A small device can fail on a large area. Choose a smaller area.
- **The page loads twice at the first visit.** The page needs headers that make the browser use threads. The host cannot send them, so a small script in the page adds them and loads the page again. In a test with a fast link, the second load starts after about half a second. A hard reload (Shift + reload) skips the script, and the page then builds with one thread. [Hosting](proposals/hosting.md) has the reason.
- **A red bar says "the browser may have an old file".** Press Ctrl+Shift+R one time.
- **Street View or Google 3D shows nothing.** These tools need a key. [Keys and settings](dashboard.md#keys-and-settings) tells you how to give one.
- **Your areas is empty.** The browser keeps saved areas for one address only. Clear the site data, or open the page at another address, and they go.
