package ai.abyssinia.mobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.content.Intent;
import android.content.ActivityNotFoundException;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.speech.RecognizerIntent;
import android.text.InputType;
import android.view.View;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class AssistantActivity extends Activity {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private SharedPreferences prefs;
    private LinearLayout root, messages;
    private ScrollView scroll;
    private EditText draft;
    private TextView status, providerBadge;
    private static final String[] NAMES = {"Google Gemini", "OpenAI", "OpenRouter", "Custom"};
    private static final String[] BASES = {"https://generativelanguage.googleapis.com/v1beta/openai", "https://api.openai.com/v1", "https://openrouter.ai/api/v1", ""};
    private static final String[] MODELS = {"gemini-4-hydrogen", "", "", ""};
    private String baseUrl() { return prefs.getString("base", BASES[0]); }
    private String modelId() { return prefs.getString("model", MODELS[preset(baseUrl())]); }
    private int preset(String url) {
        for (int i=0; i<BASES.length-1; i++) if (BASES[i].equals(url)) return i;
        return BASES.length-1;
    }
    private void panel(View v, int radius, String fill) {
        android.graphics.drawable.GradientDrawable bg = new android.graphics.drawable.GradientDrawable();
        bg.setColor(Color.parseColor(fill));
        bg.setCornerRadius(dp(radius));
        bg.setStroke(dp(1), Color.parseColor("#39443f"));
        v.setBackground(bg);
        v.setPadding(dp(14),dp(10),dp(14),dp(10));
    }
    private Button send, settings;
    private String key = "";
    private JSONArray history;
    private boolean busy;
    private volatile HttpURLConnection connection;

    private int dp(int n) { return Math.round(n * getResources().getDisplayMetrics().density); }
    private LinearLayout column() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        return l;
    }
    private TextView text(String value, int size) {
        TextView t = new TextView(this);
        t.setText(value); t.setTextSize(size);
        t.setPadding(0,dp(5),0,dp(5));
        t.setTextIsSelectable(true);
        return t;
    }
    private Button button(String label, String description, View.OnClickListener action) {
        Button b = new Button(this);
        b.setAllCaps(false); b.setText(label); b.setContentDescription(description);
        b.setOnClickListener(action); return b;
    }
    private EditText input(String hint, String value) {
        EditText e = new EditText(this);
        e.setHint(hint); e.setContentDescription(hint); e.setSingleLine(true); e.setText(value);
        return e;
    }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("assistant", MODE_PRIVATE);
        try { history = new JSONArray(prefs.getString("history","[]")); }
        catch (JSONException ignored) { history = new JSONArray(); }
        root = column(); root.setBackgroundColor(Color.rgb(19,23,25));
        root.setPadding(dp(16),dp(10),dp(16),dp(12)); root.setFitsSystemWindows(true);
        setContentView(root);
        LinearLayout top = new LinearLayout(this);
        top.setGravity(android.view.Gravity.CENTER_VERTICAL);
        TextView brand=text("Abyssinia AI",20);
        android.graphics.drawable.GradientDrawable flag=new android.graphics.drawable.GradientDrawable(
            android.graphics.drawable.GradientDrawable.Orientation.LEFT_RIGHT,
            new int[]{0xffa5dbab,0xfffcdf83,0xfff5a293});
        flag.setCornerRadius(dp(7)); brand.setBackground(flag); brand.setTextColor(0xff172723);
        brand.setPadding(dp(10),dp(4),dp(10),dp(4)); top.addView(brand);
        top.addView(new View(this),new LinearLayout.LayoutParams(0,1,1));
        settings = button("ቅንብሮች","Settings",v -> configure());
        panel(settings,10,"#22292c"); top.addView(settings); root.addView(top);
        providerBadge=text(NAMES[preset(baseUrl())]+" · "+modelId(),14);
        providerBadge.setTextColor(0xff9bdfcf); root.addView(providerBadge);
        scroll = new ScrollView(this); messages = column(); scroll.addView(messages);
        root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
        render();
        status=text("",14);status.setVisibility(View.GONE);root.addView(status);
        draft=input("መልዕክት ይጻፉ",state==null?"":state.getString("draft",""));
        draft.setSingleLine(false); draft.setMaxLines(4);
        LinearLayout composer=column(); panel(composer,23,"#212629"); root.addView(composer);
        draft.setBackgroundColor(Color.TRANSPARENT); composer.addView(draft);
        LinearLayout actions=new LinearLayout(this);
        actions.addView(button("🎙","Dictate",v -> dictate()));
        send=button("ላክ","Send",v -> submit()); actions.addView(new View(this),new LinearLayout.LayoutParams(0,1,1));
        panel(send,12,"#185649"); actions.addView(send);
        composer.addView(actions);
    }
    private void render() {
        messages.removeAllViews();
        if(history.length()==0) {
            TextView welcome=text("ሰላም፣ ዛሬ ምን ልርዳዎት?",30);
            welcome.setPadding(0,dp(36),0,dp(20)); messages.addView(welcome);
            for(String prompt : new String[]{"ጽሑፍ ለማዘጋጀት እርዳኝ", "ለዛሬ የሥራ እቅድ እናውጣ"}) {
                Button suggestion=button(prompt,prompt,v->{draft.setText(prompt);draft.setSelection(prompt.length());draft.requestFocus();});
                panel(suggestion,14,"#232b2c"); addCard(suggestion);
            }
        }
        for(int i=0;i<history.length();i++){
            JSONObject m=history.optJSONObject(i); if(m==null)continue;
            TextView t=text(("assistant".equals(m.optString("role"))?"Abyssinia AI":"እርስዎ")+"\n"+m.optString("content"),17);
            panel(t,14,"assistant".equals(m.optString("role"))?"#22292c":"#25443e"); addCard(t);
        }
        scroll.post(()->scroll.fullScroll(View.FOCUS_DOWN));
    }
    private void addCard(View card) {
        LinearLayout.LayoutParams layout=new LinearLayout.LayoutParams(-1,-2);
        layout.bottomMargin=dp(10); messages.addView(card,layout);
    }
    private void configure() {
        LinearLayout form=column(); form.setPadding(dp(20),0,dp(20),0);
        EditText base=input("HTTPS API base URL",baseUrl());
        EditText model=input("Model ID",modelId());
        EditText secret=input("API key · current session",key);
        secret.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);
        Spinner providers=new Spinner(this);
        providers.setContentDescription("Provider");
        providers.setAdapter(new ArrayAdapter<String>(this,android.R.layout.simple_spinner_dropdown_item,NAMES));
        int initial=preset(baseUrl()); providers.setSelection(initial); base.setEnabled(initial==NAMES.length-1);
        providers.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener(){
            int previous=initial;
            public void onNothingSelected(AdapterView<?> parent){}
            public void onItemSelected(AdapterView<?> parent,View view,int pos,long row){
                if(previous==pos)return;
                previous=pos; secret.setText("");
                base.setEnabled(pos==NAMES.length-1); base.setText(BASES[pos]); model.setText(MODELS[pos]);
            }
        });
        ScrollView settingsScroll=new ScrollView(this); settingsScroll.addView(form);
        form.addView(providers); form.addView(base);form.addView(model);form.addView(secret);
        form.addView(text("Abyssinia AI · AK ETHIO AI\nመልዕክቶችዎ ወደሚመርጡት አቅራቢ ይላካሉ።\nUse a Chat Completions endpoint. Your key stays in memory.",14));
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle("አቅራቢ · Provider").setView(settingsScroll)
            .setNegativeButton(android.R.string.cancel,null).setPositiveButton("Save",null).create();
        dialog.show();
        dialog.getButton(-1).setOnClickListener(v -> {
            String endpoint=base.getText().toString().trim().replaceAll("/+$","");
            String id=model.getText().toString().trim();
            try { endpointUrl(endpoint); } catch(Exception e){base.setError("Use HTTPS or device loopback");return;}
            if(id.isEmpty()||id.length()>256){model.setError("Enter a model ID");return;}
            String old=baseUrl();
            if(!old.equals(endpoint)&&!key.isEmpty()&&secret.getText().toString().equals(key)){
                secret.setText("");secret.setError("Enter a key for this endpoint");return;
            }
            if(!old.equals(endpoint)||!id.equals(modelId())){
                history=new JSONArray();prefs.edit().remove("history").apply();render();
            }
            key=secret.getText().toString().trim();
            prefs.edit().putString("base",endpoint).putString("model",id).apply();providerBadge.setText(NAMES[preset(endpoint)]+" · "+id);dialog.dismiss();
        });
    }
    private static URL endpointUrl(String base) throws Exception {
        URL u=new URL(base);
        if(u.getHost().isEmpty()||u.getUserInfo()!=null||u.getQuery()!=null||u.getRef()!=null ||
            !("https".equals(u.getProtocol())||("http".equals(u.getProtocol())&&"127.0.0.1".equals(u.getHost()))))throw new IOException();
        return new URL(base+"/chat/completions");
    }
    private void dictate(){
        if(busy)return;
        Intent i=new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL,RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE,"am-ET");
        try{startActivityForResult(i,1);}catch(ActivityNotFoundException e){notice("የጽሑፍ ቃል ማስገቢያ በዚህ ስልክ አልተገኘም።");}
    }
    @Override protected void onActivityResult(int code,int result,Intent data){
        super.onActivityResult(code,result,data);
        if(code==1&&result==RESULT_OK&&data!=null){
            ArrayList<String> words=data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            if(words!=null&&!words.isEmpty())draft.append((draft.length()>0?" ":"")+words.get(0));
        }
    }
    private static JSONObject message(String role,String content) throws JSONException {
        return new JSONObject().put("role",role).put("content",content);
    }
    private void notice(String msg){Toast.makeText(this,msg,Toast.LENGTH_LONG).show();}
    private void submit(){
        String prompt=draft.getText().toString().trim(),model=modelId();
        if(prompt.isEmpty()||busy)return;
        if(prompt.length()>8000){draft.setError("8,000 characters maximum");return;}
        if(model.isEmpty() || (preset(baseUrl())<NAMES.length-1 && key.isEmpty())){configure();return;}
        final String base=baseUrl(),token=key;
        final JSONArray turns=new JSONArray();
        try{
            turns.put(message("system","You are Abyssinia AI. Reply in natural Amharic by default. Follow the user's explicit language choice."));
            for(int i=Math.max(0,history.length()-8);i<history.length();i++)turns.put(history.get(i));
            turns.put(message("user",prompt));
        }catch(JSONException e){return;}
        status.setVisibility(View.GONE);busy=true;send.setEnabled(false);settings.setEnabled(false);draft.setEnabled(false);send.setText("ቆይ…");
        worker.execute(()->{
            try{
                String answer=request(base,token,new JSONObject().put("model",model).put("messages",turns));
                runOnUiThread(()->{
                    if(isDestroyed())return;
                    try{
                        history.put(message("user",prompt)).put(message("assistant",answer));
                        while(history.length()>40)history.remove(0);
                        prefs.edit().putString("history",history.toString()).apply();draft.setText("");render();
                    }catch(JSONException ignored){}
                });
            }catch(Exception e){runOnUiThread(()->{if(!isDestroyed()){status.setText("መልስ አልተገኘም። Check the provider URL, model and key. ("+e.getClass().getSimpleName()+")");status.setVisibility(View.VISIBLE);}});}
            finally{runOnUiThread(()->{if(!isDestroyed()){busy=false;send.setText("ላክ");send.setEnabled(true);settings.setEnabled(true);draft.setEnabled(true);}});}
        });
    }
    private String request(String base,String token,JSONObject payload) throws Exception {
        HttpURLConnection c=(HttpURLConnection)endpointUrl(base).openConnection();connection=c;
        try{
            c.setInstanceFollowRedirects(false);c.setRequestMethod("POST");c.setDoOutput(true);
            c.setConnectTimeout(15000);c.setReadTimeout(90000);c.setRequestProperty("Content-Type","application/json");
            if(!token.isEmpty())c.setRequestProperty("Authorization","Bearer "+token);
            try(OutputStream out=c.getOutputStream()){out.write(payload.toString().getBytes(StandardCharsets.UTF_8));}
            if(c.getResponseCode()!=200)throw new IOException();
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();
            try(InputStream in=c.getInputStream()){byte[] block=new byte[8192];int count;while((count=in.read(block))!=-1){
                if(bytes.size()+count>1048576)throw new IOException();bytes.write(block,0,count);
            }}
            String reply=new JSONObject(bytes.toString("UTF-8")).getJSONArray("choices").getJSONObject(0)
                .getJSONObject("message").getString("content").trim();
            if(reply.isEmpty()||reply.length()>64000)throw new IOException();
            return reply;
        }finally{c.disconnect();connection=null;}
    }
    @Override protected void onSaveInstanceState(Bundle b){super.onSaveInstanceState(b);b.putString("draft",draft.getText().toString());}
    @Override protected void onDestroy(){HttpURLConnection active=connection;if(active!=null)active.disconnect();worker.shutdownNow();key="";super.onDestroy();}
}
