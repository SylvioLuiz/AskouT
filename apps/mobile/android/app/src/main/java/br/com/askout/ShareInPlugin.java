package br.com.askout;

import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * "Compartilhar com o AskouT" vindo de outro app (Galeria, Arquivos, navegador...). A MainActivity entrega o Intent
 * (ACTION_SEND / ACTION_SEND_MULTIPLE); os arquivos são copiados para o cache do app e o app web pega com take()
 * (ponte window.AskouTShareIn, ver apps/mobile/src/main.ts e apps/web/src/lib/share-in.ts).
 * Compartilhamento novo com o app aberto avisa pelo evento "received".
 */
@CapacitorPlugin(name = "AskouTShareIn")
public class ShareInPlugin extends Plugin {

    /** Igual ao app web: até 10 arquivos, cada um até 60 MB (o chat ainda confere o limite de cada tipo). */
    static final int MAX_FILES = 10;
    static final long MAX_BYTES = 60L * 1024 * 1024;

    private static JSObject pending;
    private static ShareInPlugin instance;

    @Override
    public void load() {
        instance = this;
    }

    @PluginMethod
    public void take(PluginCall call) {
        JSObject result = new JSObject();
        synchronized (ShareInPlugin.class) {
            result.put("share", pending);
            pending = null;
        }
        call.resolve(result);
    }

    /** Chamado pela MainActivity ao abrir (onCreate) e com o app aberto (onNewIntent). Copia fora da tela principal. */
    static void receive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return;
        final Context app = context.getApplicationContext();
        final List<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri one = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (one != null) uris.add(one);
        } else {
            ArrayList<Uri> many = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (many != null) uris.addAll(many);
        }
        final CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        final String fallbackType = intent.getType();
        // O Intent foi consumido: girar a tela não repete o compartilhamento.
        intent.setAction(Intent.ACTION_MAIN);
        new Thread(() -> {
            JSArray items = new JSArray();
            File dir = new File(app.getCacheDir(), "shared/" + UUID.randomUUID());
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            int count = 0;
            for (Uri uri : uris) {
                if (count >= MAX_FILES) break;
                JSObject item = copy(app, uri, dir, fallbackType);
                if (item != null) {
                    items.put(item);
                    count++;
                }
            }
            JSObject share = new JSObject();
            share.put("items", items);
            if (text != null) share.put("text", text.toString());
            synchronized (ShareInPlugin.class) {
                pending = share;
            }
            ShareInPlugin live = instance;
            if (live != null) live.notifyListeners("received", new JSObject());
        }).start();
    }

    private static JSObject copy(Context context, Uri uri, File dir, String fallbackType) {
        ContentResolver resolver = context.getContentResolver();
        String name = displayName(resolver, uri);
        String mime = resolver.getType(uri);
        if (mime == null) mime = fallbackType != null && !fallbackType.endsWith("/*") ? fallbackType : "application/octet-stream";
        String safe = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
        if (safe.isEmpty()) safe = "arquivo";
        File out = new File(dir, safe);
        long total = 0;
        try (InputStream in = resolver.openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
            if (in == null) return null;
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = in.read(buffer)) != -1) {
                total += read;
                if (total > MAX_BYTES) {
                    os.close();
                    //noinspection ResultOfMethodCallIgnored
                    out.delete();
                    return null;
                }
                os.write(buffer, 0, read);
            }
        } catch (Exception e) {
            //noinspection ResultOfMethodCallIgnored
            out.delete();
            return null;
        }
        JSObject item = new JSObject();
        item.put("path", Uri.fromFile(out).toString());
        item.put("name", name);
        item.put("mime", mime);
        return item;
    }

    private static String displayName(ContentResolver resolver, Uri uri) {
        try (Cursor cursor = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                String value = cursor.getString(0);
                if (value != null && !value.isEmpty()) return value;
            }
        } catch (Exception ignored) {
            // Sem nome: usa o fim do endereço.
        }
        String last = uri.getLastPathSegment();
        return last != null && !last.isEmpty() ? last : "arquivo";
    }
}
