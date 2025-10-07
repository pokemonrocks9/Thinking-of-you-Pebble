// PebbleKit JS for Thinking of You app with Location Features
var API_ENDPOINT = 'https://mute-elsinore-pokyplays-01040d8f.koyeb.app/api';

var linkCode = '';
var myName = '';
var partnerName = '';
var webhookUrl = '';
var shareLocation = false;
var isConfigured = false;
var pollInterval = null;

// ===== CIPHER FUNCTIONS =====

function hashLinkCode(linkCode) {
  // Create a stronger key by hashing the linkCode
  var hash = 0;
  for (var i = 0; i < linkCode.length; i++) {
    hash = ((hash << 5) - hash) + linkCode.charCodeAt(i);
    hash = hash & hash;
  }
  // Expand hash to create longer key material
  var expanded = hash.toString(36) + linkCode + hash.toString(16) + linkCode.split('').reverse().join('');
  return expanded;
}

function deriveKey(linkCode) {
  var hashed = hashLinkCode(linkCode);
  var key = [];
  for (var i = 0; i < hashed.length; i++) {
    key.push(hashed.charCodeAt(i));
  }
  return key;
}

function jumbleData(data, linkCode) {
  var key = deriveKey(linkCode);
  var bytes = [];
  
  for (var i = 0; i < data.length; i++) {
    bytes.push(data.charCodeAt(i) ^ key[i % key.length]);
  }
  
  // Convert to base64
  var binaryString = String.fromCharCode.apply(null, bytes);
  return btoa(binaryString);
}

function unjumbleData(jumbled, linkCode) {
  try {
    // Decode from base64
    var binaryString = atob(jumbled);
    var key = deriveKey(linkCode);
    var result = '';
    
    for (var i = 0; i < binaryString.length; i++) {
      result += String.fromCharCode(binaryString.charCodeAt(i) ^ key[i % key.length]);
    }
    
    return result;
  } catch (e) {
    console.log('Error unjumbling data: ' + e);
    return null;
  }
}

function jumbleCoordinates(lat, lon, linkCode) {
  var coordString = lat.toFixed(6) + ',' + lon.toFixed(6);
  return jumbleData(coordString, linkCode);
}

function unjumbleCoordinates(jumbled, linkCode) {
  var coordString = unjumbleData(jumbled, linkCode);
  if (!coordString) return null;
  
  var parts = coordString.split(',');
  if (parts.length !== 2) return null;
  
  return {
    lat: parseFloat(parts[0]),
    lon: parseFloat(parts[1])
  };
}

function jumbleDistance(distanceKm, linkCode) {
  return jumbleData(distanceKm.toString(), linkCode);
}

function unjumbleDistance(jumbled, linkCode) {
  var distString = unjumbleData(jumbled, linkCode);
  return distString ? parseInt(distString) : null;
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  // Haversine formula for distance between two coordinates
  var R = 6371; // Earth's radius in km
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLon = (lon2 - lon1) * Math.PI / 180;
  var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
          Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
          Math.sin(dLon/2) * Math.sin(dLon/2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  var distance = R * c;
  return Math.round(distance); // Return distance in km
}

// ===== UTILITY FUNCTIONS =====

function generateLinkCode() {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var code = '';
  for (var i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function loadSettings() {
  linkCode = localStorage.getItem('linkCode') || '';
  myName = localStorage.getItem('myName') || '';
  partnerName = localStorage.getItem('partnerName') || '';
  webhookUrl = localStorage.getItem('webhookUrl') || '';
  
  // Default to true if not set, otherwise parse the stored value
  var storedLocation = localStorage.getItem('shareLocation');
  if (storedLocation === null) {
    shareLocation = true; // DEFAULT TO ENABLED
    console.log('No shareLocation setting found - defaulting to ENABLED');
  } else {
    shareLocation = storedLocation === 'true';
  }
  
  if (!linkCode) {
    linkCode = generateLinkCode();
    localStorage.setItem('linkCode', linkCode);
    console.log('Generated new link code: ' + linkCode);
  }
  
  // For watchfaces, only require myName to be set
  isConfigured = (myName !== '');
  console.log('=== SETTINGS LOADED ===');
  console.log('myName: ' + myName);
  console.log('partnerName: ' + partnerName);
  console.log('linkCode: ' + linkCode);
  console.log('shareLocation: ' + shareLocation + ' (type: ' + typeof shareLocation + ')');
  console.log('webhookUrl: ' + (webhookUrl ? 'SET' : 'NOT SET'));
  console.log('isConfigured: ' + isConfigured);
}

function sendConfigToWatch() {
  var dict = {
    'MESSAGE_KEY_MY_NAME': myName,
    'MESSAGE_KEY_LINK_CODE': linkCode,
    'MESSAGE_KEY_READY': isConfigured ? 1 : 0
  };
  
  // Only include partner name if we have it
  if (partnerName) {
    dict['MESSAGE_KEY_PARTNER_NAME'] = partnerName;
  }
  
  Pebble.sendAppMessage(dict,
    function() {
      console.log('Config sent to watch successfully');
    },
    function(e) {
      console.log('Failed to send config to watch: ' + JSON.stringify(e));
    }
  );
}

function registerWithBackend() {
  if (!linkCode || !myName) {
    console.log('Skipping register - missing linkCode or myName');
    return;
  }
  
  console.log('=== REGISTERING WITH BACKEND ===');
  console.log('linkCode: ' + linkCode);
  console.log('myName: ' + myName);
  
  var xhr = new XMLHttpRequest();
  xhr.open('POST', API_ENDPOINT + '/register', true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.onload = function() {
    if (xhr.readyState === 4) {
      console.log('Register response status: ' + xhr.status);
      console.log('Register response body: ' + xhr.responseText);
      
      // After registering, fetch partner name from backend
      fetchPartnerName();
    }
  };
  xhr.onerror = function() {
    console.log('Register request FAILED - network error');
  };
  
  var payload = {
    linkCode: linkCode,
    name: myName,
    webhookUrl: webhookUrl
  };
  xhr.send(JSON.stringify(payload));
}

function fetchPartnerName() {
  console.log('=== FETCHING PARTNER NAME ===');
  
  var xhr = new XMLHttpRequest();
  xhr.open('GET', API_ENDPOINT + '/whoIsRegistered?linkCode=' + linkCode, true);
  xhr.onload = function() {
    if (xhr.readyState === 4 && xhr.status === 200) {
      var response = JSON.parse(xhr.responseText);
      console.log('Registered names:', JSON.stringify(response.registeredNames));
      
      if (response.registeredNames && response.registeredNames.length > 0) {
        // Find the partner (the name that's not mine)
        var foundPartner = response.registeredNames.find(function(name) {
          return name !== myName;
        });
        
        if (foundPartner) {
          partnerName = foundPartner;
          localStorage.setItem('partnerName', partnerName);
          console.log('Partner name discovered: ' + partnerName);
          
          // Update the watch with partner name
          sendConfigToWatch();
        } else {
          console.log('Partner not registered yet');
        }
      }
    }
  };
  xhr.send();
}

function sendPing() {
  if (!linkCode || !myName) {
    console.log('Cannot send ping - not configured');
    return;
  }
  
  console.log('=== SENDING PING ===');
  console.log('DEBUG: shareLocation =', shareLocation);
  console.log('DEBUG: localStorage shareLocation =', localStorage.getItem('shareLocation'));
  console.log('DEBUG: linkCode =', linkCode);
  
  if (shareLocation) {
    console.log('Location sharing ENABLED - getting GPS coordinates...');
    navigator.geolocation.getCurrentPosition(
      function(position) {
        var lat = position.coords.latitude;
        var lon = position.coords.longitude;
        console.log('✓ GPS acquired: ' + lat + ', ' + lon);
        console.log('DEBUG: About to jumble coordinates with linkCode:', linkCode);
        
        var jumbledCoords = jumbleCoordinates(lat, lon, linkCode);
        console.log('✓ Jumbled coordinates: ' + jumbledCoords.substring(0, 30) + '...');
        console.log('DEBUG: Jumbled length:', jumbledCoords.length);
        
        sendPingWithCoords(jumbledCoords);
      },
      function(error) {
        console.log('✗ GPS ERROR: code=' + error.code + ', message=' + error.message);
        console.log('Sending ping WITHOUT location');
        sendPingWithCoords(null);
      },
      { timeout: 10000, maximumAge: 60000 }
    );
  } else {
    console.log('Location sharing disabled - sending ping without location');
    sendPingWithCoords(null);
  }
}

function sendPingWithCoords(jumbledCoords) {
  var xhr = new XMLHttpRequest();
  xhr.open('POST', API_ENDPOINT + '/ping', true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.onload = function() {
    if (xhr.readyState === 4) {
      console.log('Ping response status: ' + xhr.status);
      console.log('Ping response body: ' + xhr.responseText);
      
      // If we sent location data, fetch distance after 5 seconds
      if (jumbledCoords) {
        console.log('DEBUG: Ping sent with location - will check for distance in 5 seconds');
        setTimeout(function() {
          console.log('DEBUG: 5 seconds passed - fetching distance now');
          fetchAndDisplayDistance();
        }, 5000);
      }
    }
  };
  xhr.onerror = function() {
    console.log('Ping request FAILED - network error');
  };
  
  var payload = {
    linkCode: linkCode,
    senderName: myName
  };
  
  if (jumbledCoords) {
    payload.jumbledCoords = jumbledCoords;
  }
  
  console.log('Sending ping with payload: ' + JSON.stringify(payload));
  xhr.send(JSON.stringify(payload));
}

function sendDistanceToBackend(distanceKm) {
  console.log('=== SENDING DISTANCE TO BACKEND ===');
  console.log('Distance: ' + distanceKm + ' km');
  console.log('DEBUG: linkCode for jumbling:', linkCode);
  
  var jumbledDistance = jumbleDistance(distanceKm, linkCode);
  console.log('✓ Jumbled distance: ' + jumbledDistance.substring(0, 20) + '...');
  
  var xhr = new XMLHttpRequest();
  xhr.open('POST', API_ENDPOINT + '/distance', true);
  xhr.setRequestHeader('Content-Type', 'application/json');
  xhr.onload = function() {
    if (xhr.readyState === 4) {
      console.log('✓ Distance backend response status: ' + xhr.status);
      console.log('Distance backend response body: ' + xhr.responseText);
    }
  };
  xhr.onerror = function() {
    console.log('✗ Distance request FAILED - network error');
  };
  
  var payload = JSON.stringify({
    linkCode: linkCode,
    jumbledDistance: jumbledDistance
  });
  console.log('DEBUG: Sending payload:', payload);
  xhr.send(payload);
}

function checkForPings() {
  if (!linkCode || !myName) return;
  
  // If we don't have partner name yet, try to fetch it
  if (!partnerName) {
    fetchPartnerName();
  }
  
  var xhr = new XMLHttpRequest();
  xhr.open('GET', API_ENDPOINT + '/check?linkCode=' + linkCode + '&recipientName=' + encodeURIComponent(myName), true);
  xhr.onload = function() {
    if (xhr.readyState === 4 && xhr.status === 200) {
      var response = JSON.parse(xhr.responseText);
      console.log('Check response:', JSON.stringify(response));
      
      if (response.hasPing) {
        console.log('✓ Received ping from partner!');
        
        // Send ping notification to watch with partner name
        var pingMessage = {
          'MESSAGE_KEY_RECEIVE_PING': 1
        };
        
        // Include partner name if we have it
        if (partnerName) {
          pingMessage['MESSAGE_KEY_PARTNER_NAME'] = partnerName;
        }
        
        Pebble.sendAppMessage(
          pingMessage,
          function() {
            console.log('✓ Ping notification sent to watch');
          },
          function(e) {
            console.log('✗ Failed to send ping to watch: ' + JSON.stringify(e));
          }
        );
        
        // If ping has location data, calculate and send distance
        if (response.jumbledCoords) {
          console.log('✓ Ping contains location data: ' + response.jumbledCoords.substring(0, 30) + '...');
          console.log('DEBUG: Calling handlePingWithLocation now');
          handlePingWithLocation(response.jumbledCoords);
        } else {
          console.log('Ping has NO location data');
        }
      }
    }
  };
  xhr.onerror = function() {
    console.log('✗ Check request failed');
  };
  xhr.send();
}

function handlePingWithLocation(jumbledCoords) {
  console.log('=== PROCESSING LOCATION FROM PING ===');
  console.log('DEBUG: Received jumbledCoords:', jumbledCoords.substring(0, 30) + '...');
  console.log('DEBUG: linkCode for unjumbling:', linkCode);
  
  // Unjumble the coordinates
  var senderCoords = unjumbleCoordinates(jumbledCoords, linkCode);
  if (!senderCoords) {
    console.log('✗ FAILED to unjumble coordinates');
    return;
  }
  
  console.log('✓ Unjumbled sender location: ' + senderCoords.lat + ', ' + senderCoords.lon);
  
  // Get our current location
  console.log('DEBUG: Requesting receiver GPS location...');
  navigator.geolocation.getCurrentPosition(
    function(position) {
      var myLat = position.coords.latitude;
      var myLon = position.coords.longitude;
      console.log('✓ Receiver GPS acquired: ' + myLat + ', ' + myLon);
      
      // Calculate distance in kilometers
      var distanceKm = calculateDistance(senderCoords.lat, senderCoords.lon, myLat, myLon);
      console.log('✓ Calculated distance: ' + distanceKm + ' km');
      
      // Convert to miles/feet for display
      var distanceMiles = distanceKm * 0.621371;
      var displayValue, displayUnit;
      
      if (distanceMiles < 1) {
        // Less than 1 mile - show in feet
        displayValue = Math.round(distanceMiles * 5280);
        displayUnit = 'ft';
        console.log('✓ Display: ' + displayValue + ' ' + displayUnit);
      } else {
        // 1 mile or more - show in miles
        displayValue = Math.round(distanceMiles * 10) / 10; // 1 decimal place
        displayUnit = 'mi';
        console.log('✓ Display: ' + displayValue + ' ' + displayUnit);
      }
      
      // Send distance to backend (store in km, jumbled)
      console.log('DEBUG: About to send jumbled distance to backend');
      sendDistanceToBackend(distanceKm);
      
      // Send to watch for immediate display (as integer value + unit string)
      console.log('DEBUG: Sending distance to watch for display');
      Pebble.sendAppMessage(
        {
          'MESSAGE_KEY_DISTANCE': Math.round(displayValue),
          'MESSAGE_KEY_DISTANCE_UNIT': displayUnit
        },
        function() {
          console.log('✓ Distance sent to watch: ' + displayValue + ' ' + displayUnit);
        },
        function(e) {
          console.log('✗ Failed to send distance to watch: ' + JSON.stringify(e));
        }
      );
    },
    function(error) {
      console.log('✗ FAILED to get receiver location: code=' + error.code + ', message=' + error.message);
    },
    { timeout: 15000, maximumAge: 60000, enableHighAccuracy: false }
  );
}

function fetchAndDisplayDistance() {
  if (!linkCode) return;
  
  var xhr = new XMLHttpRequest();
  xhr.open('GET', API_ENDPOINT + '/distance?linkCode=' + linkCode, true);
  xhr.onload = function() {
    if (xhr.readyState === 4 && xhr.status === 200) {
      var response = JSON.parse(xhr.responseText);
      if (response.jumbledDistance) {
        console.log('Retrieved jumbled distance from backend');
        var distanceKm = unjumbleDistance(response.jumbledDistance, linkCode);
        
        if (distanceKm !== null) {
          console.log('Unjumbled distance: ' + distanceKm + ' km');
          
          // Convert to miles/feet for display
          var distanceMiles = distanceKm * 0.621371;
          var displayValue, displayUnit;
          
          if (distanceMiles < 1) {
            // Less than 1 mile - show in feet
            displayValue = Math.round(distanceMiles * 5280);
            displayUnit = 'ft';
          } else {
            // 1 mile or more - show in miles
            displayValue = Math.round(distanceMiles * 10) / 10;
            displayUnit = 'mi';
          }
          
          console.log('Display: ' + displayValue + ' ' + displayUnit);
          
          // Send to watch for display
          Pebble.sendAppMessage(
            {
              'MESSAGE_KEY_DISTANCE': Math.round(displayValue),
              'MESSAGE_KEY_DISTANCE_UNIT': displayUnit
            },
            function() {
              console.log('Distance sent to watch: ' + displayValue + ' ' + displayUnit);
            },
            function(e) {
              console.log('Failed to send distance to watch: ' + JSON.stringify(e));
            }
          );
        }
      }
    }
  };
  xhr.send();
}

function startPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
  }
  pollInterval = setInterval(checkForPings, 5000);
  console.log('Started polling for pings');
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
  console.log('Stopped polling');
}

// ===== PEBBLE EVENT HANDLERS =====

Pebble.addEventListener('ready', function(e) {
  console.log('PebbleKit JS ready!');
  loadSettings();
  sendConfigToWatch();
  
  if (isConfigured) {
    registerWithBackend();
    fetchAndDisplayDistance(); // Get last distance on startup
    startPolling();
  }
});

Pebble.addEventListener('appmessage', function(e) {
  console.log('Received message from watch');
  
  if (e.payload.MESSAGE_KEY_SEND_PING) {
    console.log('Watch requested to send ping');
    sendPing();
  }
});

Pebble.addEventListener('showConfiguration', function(e) {
  var url = 'https://pokemonrocks9.github.io/thinking-of-you-config/?linkCode=' + encodeURIComponent(linkCode) +
            '&myName=' + encodeURIComponent(myName) +
            '&partnerName=' + encodeURIComponent(partnerName) +
            '&shareLocation=' + encodeURIComponent(shareLocation);
  console.log('Opening config page: ' + url);
  Pebble.openURL(url);
});

Pebble.addEventListener('webviewclosed', function(e) {
  console.log('Configuration window closed');
  
  if (e && e.response) {
    console.log('Raw response: ' + e.response);
    var configData = JSON.parse(decodeURIComponent(e.response));
    console.log('Parsed config: ' + JSON.stringify(configData));
    
    if (configData.myName) {
      myName = configData.myName;
      localStorage.setItem('myName', myName);
      console.log('Saved myName: ' + myName);
    }
    
    if (configData.partnerName) {
      partnerName = configData.partnerName;
      localStorage.setItem('partnerName', partnerName);
      console.log('Saved partnerName: ' + partnerName);
    }
    
    if (configData.webhookUrl) {
      webhookUrl = configData.webhookUrl;
      localStorage.setItem('webhookUrl', webhookUrl);
      console.log('Saved webhookUrl');
    }
    
    if (configData.partnerLinkCode) {
      linkCode = configData.partnerLinkCode;
      localStorage.setItem('linkCode', linkCode);
      console.log('Joined with partner linkCode: ' + linkCode);
    }
    
    if (configData.shareLocation !== undefined) {
      shareLocation = configData.shareLocation;
      localStorage.setItem('shareLocation', shareLocation.toString());
      console.log('Saved shareLocation: ' + shareLocation + ' (type: ' + typeof shareLocation + ')');
    }
    
    // For watchfaces, we only need myName to be configured (not partnerName)
    isConfigured = (myName !== '');
    console.log('After config: isConfigured=' + isConfigured);
    
    // Reload all settings to ensure shareLocation variable is updated
    loadSettings();
    console.log('DEBUG: Reloaded settings after config, shareLocation now = ' + shareLocation);
    
    sendConfigToWatch();
    
    if (isConfigured) {
      console.log('Calling registerWithBackend');
      registerWithBackend();
      fetchAndDisplayDistance();
      startPolling();
    }
  } else {
    console.log('No response from config page');
  }
});