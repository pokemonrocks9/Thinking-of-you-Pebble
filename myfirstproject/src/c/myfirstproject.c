#include <pebble.h>

#define MESSAGE_KEY_SEND_PING 0
#define MESSAGE_KEY_RECEIVE_PING 1
#define MESSAGE_KEY_PARTNER_NAME 2
#define MESSAGE_KEY_MY_NAME 3
#define MESSAGE_KEY_LINK_CODE 4
#define MESSAGE_KEY_READY 5
#define MESSAGE_KEY_DISTANCE 6
#define MESSAGE_KEY_DISTANCE_UNIT 7

static Window *s_main_window;
static TextLayer *s_status_layer;
static TextLayer *s_instruction_layer;
static TextLayer *s_distance_layer;
static BitmapLayer *s_icon_layer;
static GBitmap *s_heart_bitmap;

static char s_partner_name[32] = "Partner";
static char s_my_name[32] = "Me";
static char s_link_code[16] = "";
static char s_distance_text[32] = "";
static char s_distance_unit[8] = "mi";
static bool s_is_configured = false;

static Window *s_notification_window;
static TextLayer *s_notification_layer;
static TextLayer *s_notification_name_layer;

static void prv_reset_status_text(void *data) {
  text_layer_set_text(s_status_layer, "Connected!");
}

static void prv_show_notification(const char *name) {
  if (!s_notification_window) {
    s_notification_window = window_create();
    window_set_background_color(s_notification_window, GColorFolly);
    
    Layer *window_layer = window_get_root_layer(s_notification_window);
    GRect bounds = layer_get_bounds(window_layer);
    
    s_notification_name_layer = text_layer_create(GRect(0, 40, bounds.size.w, 40));
    text_layer_set_background_color(s_notification_name_layer, GColorClear);
    text_layer_set_text_color(s_notification_name_layer, GColorWhite);
    text_layer_set_font(s_notification_name_layer, fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD));
    text_layer_set_text_alignment(s_notification_name_layer, GTextAlignmentCenter);
    layer_add_child(window_layer, text_layer_get_layer(s_notification_name_layer));
    
    s_notification_layer = text_layer_create(GRect(0, 85, bounds.size.w, 60));
    text_layer_set_background_color(s_notification_layer, GColorClear);
    text_layer_set_text_color(s_notification_layer, GColorWhite);
    text_layer_set_font(s_notification_layer, fonts_get_system_font(FONT_KEY_GOTHIC_24));
    text_layer_set_text_alignment(s_notification_layer, GTextAlignmentCenter);
    text_layer_set_text(s_notification_layer, "is thinking\nabout you!");
    layer_add_child(window_layer, text_layer_get_layer(s_notification_layer));
  }
  
  text_layer_set_text(s_notification_name_layer, name);
  
  vibes_double_pulse();
  light_enable_interaction();
  
  window_stack_push(s_notification_window, true);
  
  app_timer_register(4000, (AppTimerCallback)window_stack_pop, NULL);
}

static void prv_inbox_received_callback(DictionaryIterator *iterator, void *context) {
  Tuple *receive_ping_tuple = dict_find(iterator, MESSAGE_KEY_RECEIVE_PING);
  Tuple *partner_name_tuple = dict_find(iterator, MESSAGE_KEY_PARTNER_NAME);
  Tuple *my_name_tuple = dict_find(iterator, MESSAGE_KEY_MY_NAME);
  Tuple *link_code_tuple = dict_find(iterator, MESSAGE_KEY_LINK_CODE);
  Tuple *ready_tuple = dict_find(iterator, MESSAGE_KEY_READY);
  Tuple *distance_tuple = dict_find(iterator, MESSAGE_KEY_DISTANCE);
  Tuple *distance_unit_tuple = dict_find(iterator, MESSAGE_KEY_DISTANCE_UNIT);
  
  if (receive_ping_tuple) {
    APP_LOG(APP_LOG_LEVEL_INFO, "Received ping from partner!");
    prv_show_notification(s_partner_name);
  }
  
  if (partner_name_tuple) {
    snprintf(s_partner_name, sizeof(s_partner_name), "%s", partner_name_tuple->value->cstring);
    APP_LOG(APP_LOG_LEVEL_INFO, "Partner name set to: %s", s_partner_name);
  }
  
  if (my_name_tuple) {
    snprintf(s_my_name, sizeof(s_my_name), "%s", my_name_tuple->value->cstring);
    APP_LOG(APP_LOG_LEVEL_INFO, "My name set to: %s", s_my_name);
  }
  
  if (link_code_tuple) {
    snprintf(s_link_code, sizeof(s_link_code), "%s", link_code_tuple->value->cstring);
    APP_LOG(APP_LOG_LEVEL_INFO, "Link code set to: %s", s_link_code);
  }
  
  if (distance_tuple) {
    int distance = distance_tuple->value->int32;
    
    // Update unit if provided, otherwise keep current unit
    if (distance_unit_tuple) {
      snprintf(s_distance_unit, sizeof(s_distance_unit), "%s", distance_unit_tuple->value->cstring);
    }
    
    if (distance > 0) {
      snprintf(s_distance_text, sizeof(s_distance_text), "%d %s", distance, s_distance_unit);
      text_layer_set_text(s_distance_layer, s_distance_text);
      APP_LOG(APP_LOG_LEVEL_INFO, "Distance updated: %d %s", distance, s_distance_unit);
    } else {
      text_layer_set_text(s_distance_layer, "");
    }
  }
  
  if (ready_tuple && ready_tuple->value->int32 == 1) {
    s_is_configured = true;
    text_layer_set_text(s_status_layer, "Connected!");
    text_layer_set_text(s_instruction_layer, "Press SELECT\nto send");
    APP_LOG(APP_LOG_LEVEL_INFO, "App configured and ready!");
  }
}

static void prv_inbox_dropped_callback(AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_ERROR, "Message dropped: %d", (int)reason);
}

static void prv_outbox_failed_callback(DictionaryIterator *iterator, AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_ERROR, "Outbox send failed: %d", (int)reason);
}

static void prv_outbox_sent_callback(DictionaryIterator *iterator, void *context) {
  APP_LOG(APP_LOG_LEVEL_INFO, "Outbox send success!");
}

static void prv_send_ping(void) {
  if (!s_is_configured) {
    vibes_short_pulse();
    text_layer_set_text(s_status_layer, "Not configured");
    text_layer_set_text(s_instruction_layer, "Open settings\non phone");
    return;
  }
  
  DictionaryIterator *iter;
  app_message_outbox_begin(&iter);
  dict_write_uint8(iter, MESSAGE_KEY_SEND_PING, 1);
  app_message_outbox_send();
  
  vibes_short_pulse();
  text_layer_set_text(s_status_layer, "Sent!");
  
  app_timer_register(2000, prv_reset_status_text, NULL);
}

static void prv_select_click_handler(ClickRecognizerRef recognizer, void *context) {
  prv_send_ping();
}

static void prv_click_config_provider(void *context) {
  window_single_click_subscribe(BUTTON_ID_SELECT, prv_select_click_handler);
}

static void prv_main_window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);
  
  window_set_background_color(window, GColorBlack);
  
  s_heart_bitmap = gbitmap_create_with_resource(RESOURCE_ID_HEART_ICON);
  s_icon_layer = bitmap_layer_create(GRect(52, 20, 40, 40));
  bitmap_layer_set_bitmap(s_icon_layer, s_heart_bitmap);
  bitmap_layer_set_compositing_mode(s_icon_layer, GCompOpSet);
  layer_add_child(window_layer, bitmap_layer_get_layer(s_icon_layer));
  
  s_status_layer = text_layer_create(GRect(0, 70, bounds.size.w, 30));
  text_layer_set_background_color(s_status_layer, GColorClear);
  text_layer_set_text_color(s_status_layer, GColorWhite);
  text_layer_set_text(s_status_layer, "Connecting...");
  text_layer_set_font(s_status_layer, fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD));
  text_layer_set_text_alignment(s_status_layer, GTextAlignmentCenter);
  layer_add_child(window_layer, text_layer_get_layer(s_status_layer));
  
  s_distance_layer = text_layer_create(GRect(0, 100, bounds.size.w, 25));
  text_layer_set_background_color(s_distance_layer, GColorClear);
  text_layer_set_text_color(s_distance_layer, GColorWhite);
  text_layer_set_text(s_distance_layer, "");
  text_layer_set_font(s_distance_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18));
  text_layer_set_text_alignment(s_distance_layer, GTextAlignmentCenter);
  layer_add_child(window_layer, text_layer_get_layer(s_distance_layer));
  
  s_instruction_layer = text_layer_create(GRect(10, 125, bounds.size.w - 20, 50));
  text_layer_set_background_color(s_instruction_layer, GColorClear);
  text_layer_set_text_color(s_instruction_layer, GColorWhite);
  text_layer_set_text(s_instruction_layer, "Open settings\non phone");
  text_layer_set_font(s_instruction_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18));
  text_layer_set_text_alignment(s_instruction_layer, GTextAlignmentCenter);
  layer_add_child(window_layer, text_layer_get_layer(s_instruction_layer));
}

static void prv_main_window_unload(Window *window) {
  text_layer_destroy(s_status_layer);
  text_layer_destroy(s_distance_layer);
  text_layer_destroy(s_instruction_layer);
  bitmap_layer_destroy(s_icon_layer);
  gbitmap_destroy(s_heart_bitmap);
}

static void prv_init(void) {
  app_message_register_inbox_received(prv_inbox_received_callback);
  app_message_register_inbox_dropped(prv_inbox_dropped_callback);
  app_message_register_outbox_failed(prv_outbox_failed_callback);
  app_message_register_outbox_sent(prv_outbox_sent_callback);
  
  app_message_open(256, 256);
  
  s_main_window = window_create();
  window_set_click_config_provider(s_main_window, prv_click_config_provider);
  window_set_window_handlers(s_main_window, (WindowHandlers) {
    .load = prv_main_window_load,
    .unload = prv_main_window_unload,
  });
  
  window_stack_push(s_main_window, true);
}

static void prv_deinit(void) {
  window_destroy(s_main_window);
  if (s_notification_window) {
    text_layer_destroy(s_notification_layer);
    text_layer_destroy(s_notification_name_layer);
    window_destroy(s_notification_window);
  }
}

int main(void) {
  prv_init();
  APP_LOG(APP_LOG_LEVEL_DEBUG, "Done initializing, pushed window: %p", s_main_window);
  app_event_loop();
  prv_deinit();
}