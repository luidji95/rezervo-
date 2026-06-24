"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  CalendarCheck2,
  CalendarClock,
  Check,
  CheckCheck,
  CircleX,
} from "lucide-react";
import { useSalon } from "@/context/SalonContext";
import {
  getNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  subscribeToNotifications,
  type AppNotification,
  type NotificationType,
} from "@/services/notificationService";

function NotificationIcon({ type }: { type: NotificationType }) {
  if (type === "appointment_cancelled" || type === "appointment_no_show") {
    return <CircleX size={18} aria-hidden="true" />;
  }

  if (type === "appointment_completed") {
    return <CheckCheck size={18} aria-hidden="true" />;
  }

  if (type === "appointment_rescheduled") {
    return <CalendarClock size={18} aria-hidden="true" />;
  }

  return <CalendarCheck2 size={18} aria-hidden="true" />;
}

function formatCreatedAt(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();

  if (sameDay) {
    return `Danas u ${date.toLocaleTimeString("sr-RS", {
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  }

  return date.toLocaleDateString("sr-RS", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function NotificationBell() {
  const router = useRouter();
  const { currentSalon } = useSalon();
  const containerRef = useRef<HTMLDivElement>(null);
  const knownNotificationIdsRef = useRef(new Set<string>());
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadNotifications = useCallback(async () => {
    if (!currentSalon) return;

    try {
      setLoading(true);
      const result = await getNotifications(currentSalon.id);
      knownNotificationIdsRef.current = new Set(
        result.notifications.map((notification) => notification.id)
      );
      setNotifications(result.notifications);
      setUnreadCount(result.unreadCount);
      setError("");
    } catch (loadError) {
      console.error("Failed to load notifications:", loadError);
      setError("Notifikacije trenutno nisu dostupne.");
    } finally {
      setLoading(false);
    }
  }, [currentSalon]);

  const handleIncomingNotification = useCallback(
    (notification: AppNotification) => {
      if (
        notification.salon_id !== currentSalon?.id ||
        knownNotificationIdsRef.current.has(notification.id)
      ) {
        return;
      }

      knownNotificationIdsRef.current.add(notification.id);
      setNotifications((current) => [notification, ...current].slice(0, 30));

      if (!notification.is_read) {
        setUnreadCount((current) => current + 1);
      }
    },
    [currentSalon?.id]
  );

  useEffect(() => {
    if (!currentSalon) return;

    const initialLoadTimeout = window.setTimeout(() => {
      void loadNotifications();
    }, 0);

    const unsubscribe = subscribeToNotifications(
      currentSalon.id,
      handleIncomingNotification
    );

    const handleLocalNotification = (event: Event) => {
      handleIncomingNotification(
        (event as CustomEvent<AppNotification>).detail
      );
    };

    window.addEventListener("rezervo:notification", handleLocalNotification);

    const refreshInterval = window.setInterval(() => {
      void loadNotifications();
    }, 30_000);

    const handleFocus = () => void loadNotifications();
    window.addEventListener("focus", handleFocus);

    return () => {
      unsubscribe();
      window.removeEventListener(
        "rezervo:notification",
        handleLocalNotification
      );
      window.clearTimeout(initialLoadTimeout);
      window.clearInterval(refreshInterval);
      window.removeEventListener("focus", handleFocus);
    };
  }, [currentSalon, handleIncomingNotification, loadNotifications]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleNotificationClick = async (notification: AppNotification) => {
    if (!notification.is_read) {
      setNotifications((current) =>
        current.map((item) =>
          item.id === notification.id ? { ...item, is_read: true } : item
        )
      );
      setUnreadCount((current) => Math.max(0, current - 1));

      try {
        await markNotificationAsRead(notification.id);
      } catch (markError) {
        console.error("Failed to mark notification as read:", markError);
        void loadNotifications();
      }
    }

    setIsOpen(false);

    if (notification.entity_type === "appointment" && notification.entity_id) {
      router.push(`/calendar?appointment=${encodeURIComponent(notification.entity_id)}`);
    }
  };

  const handleMarkAllAsRead = async () => {
    if (!currentSalon || unreadCount === 0) return;

    setNotifications((current) =>
      current.map((notification) => ({ ...notification, is_read: true }))
    );
    setUnreadCount(0);

    try {
      await markAllNotificationsAsRead(currentSalon.id);
    } catch (markError) {
      console.error("Failed to mark all notifications as read:", markError);
      void loadNotifications();
    }
  };

  return (
    <div className="notification-center" ref={containerRef}>
      <button
        type="button"
        className="topbar-icon-btn"
        aria-label={
          unreadCount > 0
            ? `Notifikacije, ${unreadCount} nepročitanih`
            : "Notifikacije"
        }
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        onClick={() => setIsOpen((current) => !current)}
      >
        <Bell size={20} aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="notification-count" aria-hidden="true">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <section
          className="notification-dropdown"
          role="dialog"
          aria-label="Notifikacije"
        >
          <header className="notification-dropdown__header">
            <div>
              <h2>Notifikacije</h2>
              <p>{unreadCount} nepročitanih</p>
            </div>
            {unreadCount > 0 && (
              <button type="button" onClick={handleMarkAllAsRead}>
                <Check size={15} aria-hidden="true" />
                Označi sve kao pročitano
              </button>
            )}
          </header>

          <div className="notification-dropdown__list">
            {loading && notifications.length === 0 ? (
              <p className="notification-dropdown__state">Učitavanje...</p>
            ) : error && notifications.length === 0 ? (
              <p className="notification-dropdown__state notification-dropdown__state--error">
                {error}
              </p>
            ) : notifications.length === 0 ? (
              <p className="notification-dropdown__state">
                Još uvek nema notifikacija.
              </p>
            ) : (
              notifications.map((notification) => (
                <button
                  type="button"
                  className={`notification-item${
                    notification.is_read ? "" : " notification-item--unread"
                  }`}
                  key={notification.id}
                  onClick={() => handleNotificationClick(notification)}
                >
                  <span
                    className={`notification-item__icon notification-item__icon--${notification.type}`}
                  >
                    <NotificationIcon type={notification.type} />
                  </span>
                  <span className="notification-item__content">
                    <strong>{notification.title}</strong>
                    <span>{notification.message}</span>
                    <time dateTime={notification.created_at}>
                      {formatCreatedAt(notification.created_at)}
                    </time>
                  </span>
                  {!notification.is_read && (
                    <span className="notification-item__unread" aria-label="Nepročitano" />
                  )}
                </button>
              ))
            )}
          </div>
        </section>
      )}
    </div>
  );
}
