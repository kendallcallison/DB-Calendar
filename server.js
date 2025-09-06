// server.js

const express = require('express');
const { google } = require('googleapis');
const session = require('express-session');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// User names storage file
const USER_NAMES_FILE = 'user_names.json';

// Load existing user names
function loadUserNames() {
  try {
    if (fs.existsSync(USER_NAMES_FILE)) {
      const data = fs.readFileSync(USER_NAMES_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading user names:', error);
  }
  return {};
}

// Save user names
function saveUserNames(userNames) {
  try {
    fs.writeFileSync(USER_NAMES_FILE, JSON.stringify(userNames, null, 2));
  } catch (error) {
    console.error('Error saving user names:', error);
  }
}

// Middleware
app.use(express.static('public'));
app.use(express.json());
app.use(session({
  secret: 'calendar-app-secret',
  resave: false,
  saveUninitialized: true
}));

const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  'http://---CALLBACKLINK---/oauth2callback'
);

const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/auth', (req, res) => {
  const scopes = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/spreadsheets.readonly',
    'https://www.googleapis.com/auth/userinfo.email'
  ];
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
  });
  console.log('Generated OAuth URL:', url);
  console.log('OAuth2Client redirect URI:', oauth2Client.redirectUri);
  res.redirect(url);
});

app.get('/oauth2callback', async (req, res) => {
  try {
    console.log('OAuth callback received');
    console.log('Full callback URL:', req.protocol + '://' + req.get('host') + req.originalUrl);
    const code = req.query.code;
    console.log('Authorization code received');
    
    const { tokens } = await oauth2Client.getToken(code);
    console.log('Tokens received successfully');
    
    oauth2Client.setCredentials(tokens);
    req.session.tokens = tokens;
    res.redirect('/dashboard');
  } catch (error) {
    console.error('OAuth error:', error);
    res.redirect('/?error=auth_failed');
  }
});

app.get('/dashboard', (req, res) => {
  if (!req.session.tokens) return res.redirect('/auth');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/user-info', (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: 'Not authenticated' });
  
  try {
    // Get user email from Google
    oauth2Client.setCredentials(req.session.tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    
    oauth2.userinfo.get((err, response) => {
      if (err) {
        console.error('Error getting user info:', err);
        return res.status(500).json({ error: 'Failed to get user info' });
      }
      
      const userEmail = response.data.email;
      const userNames = loadUserNames();
      const hasName = userNames[userEmail];
      
      res.json({
        email: userEmail,
        hasName: !!hasName,
        firstName: hasName || null
      });
    });
  } catch (error) {
    console.error('Error in user-info endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/save-name', (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: 'Not authenticated' });
  
  const { firstName } = req.body;
  if (!firstName || firstName.trim() === '') {
    return res.status(400).json({ error: 'First name is required' });
  }
  
  try {
    // Get user email from Google
    oauth2Client.setCredentials(req.session.tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    
    oauth2.userinfo.get((err, response) => {
      if (err) {
        console.error('Error getting user info:', err);
        return res.status(500).json({ error: 'Failed to get user info' });
      }
      
      const userEmail = response.data.email;
      const userNames = loadUserNames();
      userNames[userEmail] = firstName.trim();
      saveUserNames(userNames);
      
      res.json({ success: true, firstName: firstName.trim() });
    });
  } catch (error) {
    console.error('Error in save-name endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/test-calendar', async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: 'Not authenticated' });

  oauth2Client.setCredentials(req.session.tokens);
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  try {
    // Create a test event
    const testEvent = {
      summary: 'Test Work Shift',
      description: 'This is a test event to verify calendar integration',
      start: {
        dateTime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Tomorrow
        timeZone: 'America/Phoenix',
      },
      end: {
        dateTime: new Date(Date.now() + 24 * 60 * 60 * 1000 + 8 * 60 * 60 * 1000).toISOString(), // Tomorrow + 8 hours
        timeZone: 'America/Phoenix',
      },
    };

    const result = await calendar.events.insert({
      calendarId: 'primary',
      resource: testEvent,
    });

    res.json({ 
      success: true, 
      message: 'Test event created successfully',
      eventId: result.data.id 
    });

  } catch (error) {
    console.error('Test calendar error:', error);
    res.status(500).json({ error: 'Failed to create test event' });
  }
});

app.get('/events', async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: 'Not authenticated' });

  oauth2Client.setCredentials(req.session.tokens);

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  try {
    const result = await calendar.events.list({
      calendarId: 'primary',
      timeMin: startOfMonth.toISOString(),
      timeMax: endOfMonth.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = result.data.items.map(e => ({
      id: e.id,
      summary: e.summary,
      start: e.start.dateTime || e.start.date,
      end: e.end.dateTime || e.end.date
    }));

    res.json(events);
  } catch (err) {
    console.error('Failed to fetch events:', err);
    res.status(500).json({ error: 'Failed to retrieve events' });
  }
});

app.get('/schedule', async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: 'Not authenticated' });

  oauth2Client.setCredentials(req.session.tokens);

  const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
  const spreadsheetId = '1kgAILNyBFTsEwFVmykiVCf5J6vnqtI4mLcvgC6ss75A';
  
  // Get all available sheet tabs dynamically
  let weekTabs = [];
  try {
    const sheetsMetadata = await sheets.spreadsheets.get({
      spreadsheetId: spreadsheetId,
    });
    
    // Extract week tabs from sheet names, excluding hidden sheets
    weekTabs = sheetsMetadata.data.sheets
      .filter(sheet => !sheet.properties.hidden) // Only include visible sheets
      .map(sheet => sheet.properties.title)
      .filter(title => title.toLowerCase().includes('week'))
      .sort(); // Sort alphabetically
    
    console.log('Found week tabs:', weekTabs);
    console.log(`[SERVER] Total week tabs found: ${weekTabs.length}`);
  } catch (error) {
    console.error('Error getting sheet metadata:', error);
    // Fallback to known tabs if metadata fetch fails
    weekTabs = ['week 28_2025', 'week 29_2025', 'week 30_2025', 'week 31_2025', 'week 32_2025', 'week 33_2025', 'week 34_2025', 'week 35_2025', 'week 36_2025', 'week 37_2025', 'week 38_2025', 'week 39_2025', 'week 40_2025', 'week 41_2025', 'week 42_2025', 'week 43_2025', 'week 44_2025', 'week 45_2025', 'week 46_2025', 'week 47_2025', 'week 48_2025', 'week 49_2025', 'week 50_2025', 'week 51_2025', 'week 52_2025'];
  }
  
  const allScheduleData = [];
  const allHtmlTables = [];

  try {
    // Get data from all week tabs
    for (const tab of weekTabs) {
      try {
        // Get the raw data for processing
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: spreadsheetId,
          range: `${tab}!A:Z`,
        });

        const rows = response.data.values;
        if (!rows || rows.length === 0) continue;

        // Extract shift keys from first column (excluding header rows)
        const shifts = rows.slice(4).map(row => row[0]).filter(Boolean);
        
        // Extract date headers from row 3 (which has proper dates like "7 - Jul")
        const dateHeaders = [];
        if (rows[2]) { // Row 3 (0-indexed is 2)
          dateHeaders.push(...rows[2].slice(1).filter(Boolean));
        }
        console.log(`[SERVER] Tab "${tab}" - Date headers:`, dateHeaders);

        // Build schedule data for this tab
        // Only include shifts from rows 7-16 (day shifts) and 18-25 (night shifts)
        const schedule = [];
        for (let rowIndex = 4; rowIndex < rows.length; rowIndex++) {
          const row = rows[rowIndex];
          if (!row || !row[0]) continue; // Skip empty rows
          
          // Include rows 5, 7-16 (day shifts), 11, and 18-25 (night shifts)
          // Note: rowIndex is 0-based, so rows 5, 7-16 become indices 4, 6-15, and rows 11, 18-25 become indices 10, 17-24
          const isRequestedOff = rowIndex === 4 || rowIndex === 10; // Rows 5 and 11 (0-indexed: 4, 10)
          const isDayShift = rowIndex >= 6 && rowIndex <= 15 && rowIndex !== 10; // Rows 7-16 (0-indexed: 6-15)
          const isNightShift = rowIndex >= 17 && rowIndex <= 24; // Rows 18-25 (0-indexed: 17-24)
          
          if (isRequestedOff || isDayShift || isNightShift) {
            const shiftName = row[0];
            const shiftData = {};
            
            // Map each date to the shift value
            for (let colIndex = 1; colIndex < row.length; colIndex++) {
              const dateHeader = dateHeaders[colIndex - 1];
              if (dateHeader && row[colIndex]) {
                shiftData[dateHeader] = row[colIndex];
              }
            }
            
            console.log(`[SERVER] Tab "${tab}" - Adding shift: "${shiftName}" with dates:`, Object.keys(shiftData));
            schedule.push({
              shift: shiftName,
              dates: shiftData,
              week: tab,
              originalRow: rowIndex + 1 // Include the original row number (1-based)
            });
          }
        }

        allScheduleData.push(...schedule);
        
        // Create HTML table that looks like Google Sheets
        let htmlTable = `<div class="sheet-tab"><h3>${tab}</h3><table class="google-sheet-table">`;
        
        // Add rows from the sheet, filtering to only show specified rows
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
          const row = rows[rowIndex];
          if (!row) continue;
          
          // Include header rows (0-2) and specified shift rows (4, 6-15 for day shifts, 10, 17-24 for night shifts)
          // Note: rowIndex is 0-based, so rows 5, 7-16 become indices 4, 6-15, and rows 11, 18-25 become indices 10, 17-24
          const isHeader = rowIndex < 3;
          const isRequestedOff = rowIndex === 5 || rowIndex === 11; // Rows 5 and 11 (0-indexed: 4, 10)
          
          const isDayShift = rowIndex >= 4 && rowIndex <= 15; // Rows 7-16 (0-indexed: 6-15)
          const isNightShift = rowIndex >= 17 && rowIndex <= 24; // Rows 18-25 (0-indexed: 17-24)
          
          if (isHeader || isRequestedOff || isDayShift || isNightShift) {
            htmlTable += '<tr>';
            for (let colIndex = 0; colIndex < row.length; colIndex++) {
              const cellValue = row[colIndex] || '';
              const isShiftColumn = colIndex === 0; // First column is shift names
              
              let cellClass = '';
              if (isHeader) cellClass = 'sheet-header';
              else if (isShiftColumn) cellClass = 'shift-column';
              else if (cellValue && cellValue.trim() !== '') cellClass = 'has-employee';
              
              htmlTable += `<td class="${cellClass}">${cellValue}</td>`;
            }
            htmlTable += '</tr>';
          }
        }
        
        htmlTable += '</table></div>';
        allHtmlTables.push(htmlTable);
      } catch (error) {
        console.error(`Error fetching data from tab ${tab}:`, error);
      }
    }

    console.log(`[SERVER] Sending schedule data with ${allScheduleData.length} shifts`);
    console.log(`[SERVER] All date headers found:`, [...new Set(allScheduleData.flatMap(s => Object.keys(s.dates)))]);
    console.log(`[SERVER] Sample schedule data:`, allScheduleData.slice(0, 3));
    
    res.json({ 
      schedule: allScheduleData, 
      shifts: [...new Set(allScheduleData.map(s => s.shift))],
      dateHeaders: [...new Set(allScheduleData.flatMap(s => Object.keys(s.dates)))],
      htmlTables: allHtmlTables
    });
  } catch (err) {
    console.error('Failed to fetch schedule:', err);
    res.status(500).json({ error: 'Failed to retrieve schedule' });
  }
});

app.post('/add-shifts', async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: 'Not authenticated' });

  oauth2Client.setCredentials(req.session.tokens);

  try {
    const { employeeName, shifts, colorId } = req.body;
    
    if (!employeeName || !shifts || !Array.isArray(shifts)) {
      return res.status(400).json({ error: 'Invalid request data' });
    }

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const addedEvents = [];
    const skippedEvents = [];

      // First, fetch the schedule data from all weeks to determine row positions
      const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
      const spreadsheetId = '1kgAILNyBFTsEwFVmykiVCf5J6vnqtI4mLcvgC6ss75A';
      
      // Get all available week tabs dynamically
      let weekTabs = [];
      try {
        const sheetsMetadata = await sheets.spreadsheets.get({
          spreadsheetId: spreadsheetId,
        });
        
        // Extract week tabs from sheet names, excluding hidden sheets
        weekTabs = sheetsMetadata.data.sheets
          .filter(sheet => !sheet.properties.hidden) // Only include visible sheets
          .map(sheet => sheet.properties.title)
          .filter(title => title.toLowerCase().includes('week'))
          .sort(); // Sort alphabetically
        
        console.log('Found week tabs for add-shifts:', weekTabs);
      } catch (error) {
        console.error('Error getting sheet metadata for add-shifts:', error);
        // Fallback to known tabs if metadata fetch fails
        weekTabs = ['week 28_2025', 'week 29_2025'];
      }
      
      // Build schedule data for row lookup from all weeks
      const allScheduleData = [];
      for (const tab of weekTabs) {
        try {
          const scheduleResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: `${tab}!A:Z`,
          });
          
          const scheduleRows = scheduleResponse.data.values;
          if (!scheduleRows || scheduleRows.length === 0) continue;
          
          for (let rowIndex = 4; rowIndex < scheduleRows.length; rowIndex++) {
            const row = scheduleRows[rowIndex];
            if (!row || !row[0]) continue;
            
            // Include rows 5, 7-16 (day shifts), 11, and 18-25 (night shifts)
            // Note: rowIndex is 0-based, so rows 5, 7-16 become indices 4, 6-15, and rows 11, 18-25 become indices 10, 17-24
            const isRequestedOff = rowIndex === 4 || rowIndex === 10; // Rows 5 and 11 (0-indexed: 4, 10)
            const isDayShift = rowIndex >= 6 && rowIndex <= 15; // Rows 7-16 (0-indexed: 6-15)
            const isNightShift = rowIndex >= 17 && rowIndex <= 24; // Rows 18-25 (0-indexed: 17-24)
            
            if (isRequestedOff || isDayShift || isNightShift) {
              allScheduleData.push({ shift: row[0], rowIndex: rowIndex + 1, week: tab });
            }
          }
        } catch (error) {
          console.error(`Error fetching data from tab ${tab}:`, error);
        }
      }

      console.log(`[SERVER] Starting to process ${shifts.length} shifts for employee: ${employeeName}`);
      for (const shift of shifts) {
        try {
          console.log(`[SERVER] Processing shift: ${shift.shift} for date: ${shift.date}`);
          
          // Parse the date from the schedule format (e.g., "7 - Jul", "12 - Jul")
          const dateMatch = shift.date.match(/(\d+)\s*-\s*(\w+)/);
          if (!dateMatch) {
            console.log(`[SERVER] Could not parse date format: ${shift.date}`);
            continue;
          }
          
          const day = parseInt(dateMatch[1]);
          const monthName = dateMatch[2];
          
          console.log(`[SERVER] Parsed date: Day ${day}, Month ${monthName}`);
          
          // Convert month name to number
          const months = {
            'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
            'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
          };
          
          const month = months[monthName];
          if (month === undefined) {
            console.log(`[SERVER] Unknown month: ${monthName}`);
            continue;
          }
          
          console.log(`[SERVER] Month converted: ${monthName} -> ${month}`);
          
          // Parse shift time from shift name (e.g., "Mgr 10:00-4:00", "Server 10:00-slow")
          let startHour = 9; // Default start time
          let startMinute = 0;
          let endHour = 17; // Default end time (5 PM)
          let endMinute = 0;
          
          // Find the row this shift comes from (needed for AM/PM determination)
          const shiftInfo = allScheduleData.find(s => s.shift === shift.shift);
          const actualRow = shiftInfo ? shiftInfo.rowIndex : 0;
          
          console.log(`[SERVER] Processing shift: "${shift.shift}" for date: ${shift.date}, row: ${actualRow}`);
          console.log(`[SERVER] Shift name contains "4:00": ${shift.shift.includes('4:00')}`);
          console.log(`[SERVER] Shift name contains "close": ${shift.shift.includes('close')}`);
          
          // Extract start time from shift name format: "SHIFT_NAME START_TIME-END_TIME" or "SHIFT_NAME START_TIME-close"
          const timePattern = /(\d{1,2}):(\d{2})-(close|\d{1,2}:\d{2})/;
          const timeMatch = shift.shift.match(timePattern);
          console.log(`[SERVER] Time pattern match result:`, timeMatch);
          
          if (timeMatch) {
            // timeMatch[1] = start hour, timeMatch[2] = start minute
            startHour = parseInt(timeMatch[1]);
            startMinute = parseInt(timeMatch[2]);
            
            console.log(`[SERVER] Initial parsed start time: ${startHour}:${startMinute}`);
            console.log(`[SERVER] Row ${actualRow} - AM range (7-16): ${actualRow >= 7 && actualRow <= 16}, PM range (18-25): ${actualRow >= 18 && actualRow <= 25}`);
            
            // Determine AM/PM based on the shift pattern
            // Rows 7-16: AM shifts (except 12 o'clock)
            // Rows 18-25: PM shifts
            if (actualRow >= 7 && actualRow <= 16) {
              // AM shifts (rows 7-16)
              console.log(`[SERVER] Processing as AM shift (row ${actualRow})`);
              if (startHour !== 12) {
                // Keep as AM (no change needed for 1-11)
                console.log(`[SERVER] Start time kept as AM: ${startHour}:${startMinute}`);
              } else {
                // 12 o'clock is PM
                startHour = 12; // 12 PM
                console.log(`[SERVER] Start time 12 o'clock converted to PM: ${startHour}:${startMinute}`);
              }
            } else if (actualRow >= 18 && actualRow <= 25) {
              // PM shifts (rows 18-25)
              console.log(`[SERVER] Processing as PM shift (row ${actualRow})`);
              if (startHour !== 12) {
                startHour += 12; // Convert to 24-hour format
                console.log(`[SERVER] Start time converted to 24-hour: ${startHour}:${startMinute}`);
              } else {
                console.log(`[SERVER] Start time 12 o'clock stays as 12 PM: ${startHour}:${startMinute}`);
              }
            } else {
              console.log(`[SERVER] Row ${actualRow} not in AM/PM ranges, using default logic`);
            }
            
            // Always set end time to 5.5 hours after start time
            const endDate = new Date(new Date().getFullYear(), month, day, startHour, startMinute);
            endDate.setHours(endDate.getHours() + 5);
            endDate.setMinutes(endDate.getMinutes() + 30);
            endHour = endDate.getHours();
            endMinute = endDate.getMinutes();
            
            console.log(`[SERVER] End time calculated as 5.5 hours after start: ${endHour}:${endMinute}`);
          } else {
            console.log(`[SERVER] No time pattern found in shift name: "${shift.shift}"`);
          }
          
          console.log(`[SERVER] Final parsed time: ${startHour}:${startMinute} to ${endHour}:${endMinute}`);
          console.log(`[SERVER] Final start hour (24h): ${startHour}, Final end hour (24h): ${endHour}`);
          
          // Create event date in Arizona timezone
          const eventDate = new Date();
          eventDate.setFullYear(new Date().getFullYear());
          eventDate.setMonth(month);
          eventDate.setDate(day);
          eventDate.setHours(startHour, startMinute, 0, 0);
          
          // Create end date using the calculated end time (5.5 hours after start)
          const endDate = new Date();
          endDate.setFullYear(new Date().getFullYear());
          endDate.setMonth(month);
          endDate.setDate(day);
          endDate.setHours(endHour, endMinute, 0, 0);
          
          console.log(`[SERVER] Event date created: ${eventDate.toISOString()}`);
          console.log(`[SERVER] Event date local: ${eventDate.toString()}`);
          console.log(`[SERVER] End date created: ${endDate.toISOString()}`);
          console.log(`[SERVER] End date local: ${endDate.toString()}`);
          
          // Create calendar event
          let event;
          
          if (shift.shift.toLowerCase() === 'requests off') {
            // All-day event for time off requests
            event = {
              summary: `DB-${shift.shift}`,
              description: `Shift: ${shift.shift}\nEmployee: ${employeeName}\nDate: ${shift.date}`,
              start: {
                date: eventDate.toISOString().split('T')[0], // Just the date part
              },
              end: {
                date: eventDate.toISOString().split('T')[0], // Same date for all-day
              },
              colorId: colorId || '10', // Use selected color or default to Sage
            };
          } else {
            // Create timezone-aware date strings
            const formatDateForTimezone = (date) => {
              const year = date.getFullYear();
              const month = String(date.getMonth() + 1).padStart(2, '0');
              const day = String(date.getDate()).padStart(2, '0');
              const hours = String(date.getHours()).padStart(2, '0');
              const minutes = String(date.getMinutes()).padStart(2, '0');
              const seconds = String(date.getSeconds()).padStart(2, '0');
              return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
            };
            
            // Regular time-based event
            event = {
              summary: `DB-${shift.shift}`,
              description: `Shift: ${shift.shift}\nEmployee: ${employeeName}\nDate: ${shift.date}`,
              start: {
                dateTime: formatDateForTimezone(eventDate),
                timeZone: 'America/Phoenix',
              },
              end: {
                dateTime: formatDateForTimezone(endDate),
                timeZone: 'America/Phoenix',
              },
            };
            
            // Add color if selected
            if (colorId) {
              event.colorId = colorId;
            }
          }

          console.log('[SERVER] Creating calendar event:', JSON.stringify(event, null, 2));

          // Simple duplicate checking: same start time and date
          console.log(`[SERVER] Checking for duplicates for: ${event.summary} on ${shift.date} at ${eventDate.toISOString()}`);
          
          // Search for events on the same day
          const dayStart = new Date(eventDate);
          dayStart.setHours(0, 0, 0, 0);
          const dayEnd = new Date(eventDate);
          dayEnd.setHours(23, 59, 59, 999);
          
          console.log(`[SERVER] Searching for events on: ${dayStart.toISOString()} to ${dayEnd.toISOString()}`);
          
          const existingEvents = await calendar.events.list({
            calendarId: 'primary',
            timeMin: dayStart.toISOString(),
            timeMax: dayEnd.toISOString(),
            singleEvents: true,
          });

          console.log(`[SERVER] Found ${existingEvents.data.items.length} existing events on this day`);

          // Check for duplicate: same event title and date
          const isDuplicate = existingEvents.data.items.some(existingEvent => {
            // Check if summary (title) matches
            const summaryMatches = existingEvent.summary === event.summary;
            
            // Check if dates match (same day)
            const existingStart = new Date(existingEvent.start.dateTime || existingEvent.start.date);
            const newStart = new Date(eventDate);
            const sameDate = existingStart.toDateString() === newStart.toDateString();
            
            console.log(`[SERVER] Checking existing event: ${existingEvent.summary}`);
            console.log(`[SERVER] - Summary matches: ${summaryMatches}`);
            console.log(`[SERVER] - Same date: ${sameDate}`);
            console.log(`[SERVER] - Existing date: ${existingStart.toDateString()}`);
            console.log(`[SERVER] - New date: ${newStart.toDateString()}`);
            
            // Consider it a duplicate if both title and date match
            return summaryMatches && sameDate;
          });

          if (isDuplicate) {
            console.log(`[SERVER] Skipping duplicate event: ${event.summary} on ${shift.date}`);
            skippedEvents.push({
              shift: shift.shift,
              date: shift.date,
              reason: 'Duplicate event already exists'
            });
            continue;
          }

          const result = await calendar.events.insert({
            calendarId: 'primary',
            resource: event,
          });

          console.log(`Successfully created event with ID: ${result.data.id}`);

          addedEvents.push({
            shift: shift.shift,
            date: shift.date,
            eventId: result.data.id,
            startTime: eventDate.toISOString(),
            endTime: endDate.toISOString()
          });

        } catch (error) {
          console.error(`Error adding shift ${shift.shift} for ${shift.date}:`, error);
        }
      }

    // Store added events in session for undo functionality
    if (!req.session.recentEvents) {
      req.session.recentEvents = [];
    }
    req.session.recentEvents.push({
      timestamp: new Date().toISOString(),
      employeeName: employeeName,
      events: addedEvents
    });

    res.json({ 
      success: true, 
      message: `Added ${addedEvents.length} shifts to calendar${skippedEvents.length > 0 ? `, skipped ${skippedEvents.length} duplicates` : ''}`,
      addedEvents,
      skippedEvents
    });

  } catch (error) {
    console.error('Error adding shifts to calendar:', error);
    res.status(500).json({ error: 'Failed to add shifts to calendar' });
  }
});

app.post('/undo-last-events', async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: 'Not authenticated' });

  oauth2Client.setCredentials(req.session.tokens);

  try {
    if (!req.session.recentEvents || req.session.recentEvents.length === 0) {
      return res.json({ success: false, message: 'No recent events to undo' });
    }

    const lastEventGroup = req.session.recentEvents.pop();
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const deletedEvents = [];

    for (const event of lastEventGroup.events) {
      try {
        await calendar.events.delete({
          calendarId: 'primary',
          eventId: event.eventId,
        });
        deletedEvents.push(event);
        console.log(`Deleted event: ${event.shift} on ${event.date}`);
      } catch (error) {
        console.error(`Error deleting event ${event.eventId}:`, error);
      }
    }

    res.json({
      success: true,
      message: `Undid ${deletedEvents.length} events for ${lastEventGroup.employeeName}`,
      deletedEvents
    });

  } catch (error) {
    console.error('Error undoing events:', error);
    res.status(500).json({ error: 'Failed to undo events' });
  }
});

app.delete('/delete-event/:eventId', async (req, res) => {
  if (!req.session.tokens) return res.status(401).json({ error: 'Not authenticated' });

  oauth2Client.setCredentials(req.session.tokens);

  try {
    const { eventId } = req.params;
    
    if (!eventId || eventId === 'undefined') {
      return res.status(400).json({ error: 'Valid Event ID is required' });
    }

    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

    try {
      // First, get the event details to show in the response
      const event = await calendar.events.get({
        calendarId: 'primary',
        eventId: eventId,
      });

      // Delete the event
      await calendar.events.delete({
        calendarId: 'primary',
        eventId: eventId,
      });

      console.log(`Deleted event: ${event.data.summary}`);

      res.json({
        success: true,
        message: `Deleted event: ${event.data.summary}`,
        deletedEvent: event.data
      });

    } catch (getError) {
      if (getError.code === 404) {
        return res.status(404).json({ error: 'Event not found or already deleted' });
      }
      throw getError;
    }

  } catch (error) {
    console.error('Error deleting event:', error);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

app.listen(port, () => {
  console.log(`App running at http://---URL---:${port}`);
});
