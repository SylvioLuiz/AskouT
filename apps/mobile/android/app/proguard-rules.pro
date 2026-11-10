# Regras do R8 para o build de release do AskouT.
# O Capacitor já traz regras para as classes de plugin (@CapacitorPlugin, @PluginMethod). Aqui guardamos também
# os pacotes inteiros dos plugins: são pequenos e alguns leem classes ou JSON por reflexão. O R8 continua
# enxugando AndroidX, Google Play Services e as demais bibliotecas grandes.

# Pontes entre o WebView e o código nativo.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod, Exceptions

# Capacitor e Cordova.
-keep class com.getcapacitor.** { *; }
-keep class org.apache.cordova.** { *; }

# App (MainActivity e o que mais houver no pacote).
-keep class br.com.askout.** { *; }

# Plugins usados pelo app (ver capacitor.settings.gradle).
-keep class com.capacitorjs.plugins.** { *; }
-keep class getcapacitor.community.contacts.** { *; }
-keep class ee.forgr.capacitor.social.login.** { *; }
-keep class ee.forgr.nativepurchases.** { *; }
-keep class com.atomic.videocompressor.** { *; }

# Compras no Google Play (Billing).
-keep class com.android.vending.billing.** { *; }

# Mantém as linhas nos relatórios de erro (o Play Console desofusca com o mapping.txt que sai junto do AAB).
-keepattributes SourceFile, LineNumberTable
-renamesourcefileattribute SourceFile
